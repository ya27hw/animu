(function() {
  // App State Management
  const state = {
    activeTab: 'discover',
    titleLanguage: localStorage.getItem('titleLanguage') || 'romaji',
    animeList: [],
    userLists: { ANIME: [], MANGA: [] },
    userName: '',
    config: {},
    logs: { selected: 'combined', lines: 250, content: '', available: [] },
    history: [],
    notifications: [],
    unreadNotifCount: 0,
    discoverSeason: `${getCurrentSeason().season}_${getCurrentSeason().year}`,
    discoverChartTab: 'Airing',
    hideOnMyList: false,
    listsMediaType: 'ANIME',
    listsStatusGroup: 'ALL',
    listsViewMode: 'grid',
    searchQuery: '',
    searchEntity: 'ANIME',
    searchSort: 'POPULARITY_DESC',
    searchFilters: { format: '', status: '', season: '', year: '', genre: '', onList: '' },
    searchPage: 1,
    searchResults: [],
    searchHasNext: false,
    socialTab: 'feed',
    activeMediaDetail: null,
    activeListEditorMedia: null,
    listEntriesByMedia: {},
    listEntriesLoaded: false
  };

  // Real current AniList season (WINTER Jan-Mar, SPRING Apr-Jun, SUMMER Jul-Sep,
  // FALL Oct-Dec) — used for the chart's default season and seasonal rails.
  function getCurrentSeason() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    if (month >= 1 && month <= 3) return { season: 'WINTER', year };
    if (month >= 4 && month <= 6) return { season: 'SPRING', year };
    if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
    return { season: 'FALL', year };
  }

  const expandedHistoryIds = new Set();
  let downloadsCollapsed = false;
  // Incremented on every tab switch; async loaders capture it and bail before
  // writing DOM if it has moved — prevents stale responses rendering into the
  // now-hidden panel after rapid tab switching.
  let tabToken = 0;
  // Direct AniList reads can fan out across several Discover rails on boot.
  // Keep them in one FIFO chain so a cold load does not burst the public API.
  let anilistQueue = Promise.resolve();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isStaleTab(token) {
    return token !== tabToken;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  // Toast Notifier
  function showToast(message, type = 'success') {
    const wrapper = document.getElementById('toast-wrapper');
    if (!wrapper) return;

    const toast = document.createElement('div');
    toast.className = `p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-semibold pointer-events-auto transform translate-y-4 opacity-0 transition-all duration-300 ${
      type === 'success'
        ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200/50 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 glow-emerald'
        : 'bg-rose-50 dark:bg-rose-950/90 border-rose-200/50 dark:border-rose-900/60 text-rose-800 dark:text-rose-300 glow-rose'
    }`;

    const icon = type === 'success' ? 'fa-circle-check text-emerald-500' : 'fa-circle-exclamation text-rose-500';
    toast.innerHTML = `<i class="fa-solid ${icon} text-lg shrink-0"></i><p class="flex-grow">${escapeHtml(message)}</p>`;

    wrapper.appendChild(toast);
    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-4'), 10);
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Disables a button and swaps in a spinner while an async action runs, then
  // restores the original label. Prevents duplicate submissions on slow requests.
  function setBtnLoading(btn, loading, busyHtml = null) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('opacity-70', 'pointer-events-none', 'cursor-wait');
      btn.innerHTML = busyHtml || '<i class="fa-solid fa-spinner fa-spin"></i> Working...';
    } else {
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'pointer-events-none', 'cursor-wait');
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      delete btn.dataset.origHtml;
    }
  }

  // Title Language Formatter
  function formatTitle(titleObj) {
    if (!titleObj) return 'Untitled';
    if (typeof titleObj === 'string') return titleObj;
    const lang = state.titleLanguage;
    if (lang === 'english' && titleObj.english) return titleObj.english;
    if (lang === 'native' && titleObj.native) return titleObj.native;
    return titleObj.romaji || titleObj.english || titleObj.native || 'Untitled';
  }

  // AniList GraphQL Direct API Wrapper
  async function queryAniList(query, variables = {}) {
    const run = async () => {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      if (state.config && state.config.bearerTokenAnilist) {
        headers['Authorization'] = `Bearer ${state.config.bearerTokenAnilist}`;
      }

      let retryCount = 0;
      while (true) {
        let res;
        try {
          res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables })
          });
        } catch (fetchErr) {
          // AniList rate-limit responses (429) arrive WITHOUT the CORS
          // Access-Control-Allow-Origin header, so the browser blocks them
          // before JS ever sees the status — surfacing as a TypeError here.
          // Retry those network/CORS-level failures with backoff too.
          if (retryCount < 2) {
            const backoffSeconds = 2 * (2 ** retryCount);
            retryCount += 1;
            await sleep(backoffSeconds * 1000);
            continue;
          }
          throw new Error(fetchErr.message || 'AniList GraphQL request failed');
        }

        if (res.ok) {
          const json = await res.json();
          return json.data;
        }

        if (res.status === 429 && retryCount < 2) {
          const retryAfterHeader = res.headers?.get?.('Retry-After');
          const retryAfter = Number.parseFloat(retryAfterHeader || '');
          const backoffSeconds = 2 * (2 ** retryCount);
          const waitSeconds = Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.max(retryAfter, backoffSeconds)
            : backoffSeconds;
          retryCount += 1;
          await sleep(waitSeconds * 1000);
          continue;
        }

        const err = await res.json().catch(() => ({}));
        throw new Error(err.errors?.[0]?.message || `AniList GraphQL HTTP ${res.status}`);
      }
    };

    // Promise.then(run, run) also releases the queue after a rejected request.
    const result = anilistQueue.then(run, run);
    anilistQueue = result.catch(() => {});
    return result;
  }

  // Local Server API Wrappers
  const API = {
    async getAnime() {
      const res = await fetch('/api/anime');
      if (!res.ok) throw new Error('Failed to fetch anime watchlist.');
      return res.json();
    },
    async saveAnime(mediaId, payload) {
      const res = await fetch(`/api/anime/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to update anime overrides.');
      return res.json();
    },
    async resetAnime(mediaId) {
      const res = await fetch(`/api/anime/${mediaId}/reset`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reset downloaded episode cache.');
      return res.json();
    },
    async searchNyaa(mediaId, episode) {
      const payload = {};
      if (episode !== undefined) payload.episode = episode;
      const res = await fetch(`/api/anime/${mediaId}/nyaa-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to query Nyaa.si index.');
      return res.json();
    },
    async downloadNyaa(mediaId, link, episode) {
      const res = await fetch(`/api/anime/${mediaId}/nyaa-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link, episode })
      });
      if (!res.ok) throw new Error('Failed to start torrent download.');
      return res.json();
    },
    async getLogs(name, lines) {
      const res = await fetch(`/api/logs?name=${name || 'combined'}&lines=${lines || 250}`);
      if (!res.ok) throw new Error('Failed to load console logs.');
      return res.json();
    },
    async markRewatching(mediaId) {
      const res = await fetch(`/api/anime/${mediaId}/rewatching`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to change status to rewatching.');
      return res.json();
    },
    async getConfig() {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to fetch system configurations.');
      return res.json();
    },
    async saveConfig(payload) {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save profile overrides.');
      return res.json();
    },
    async testQbit(qbitUrl, username, password) {
      const res = await fetch('/api/test/qbittorrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qbitUrl, username, password })
      });
      if (!res.ok) throw new Error('qBittorrent connection test failed.');
      return res.json();
    },
    async testProxy(proxyAddress, proxyPort) {
      const res = await fetch('/api/test/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxyAddress, proxyPort: Number(proxyPort) })
      });
      if (!res.ok) throw new Error('Proxy connection test failed.');
      return res.json();
    },
    async testDiscord(webhook) {
      const res = await fetch('/api/test/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook })
      });
      if (!res.ok) throw new Error('Discord connection test failed.');
      return res.json();
    },
    async getDownloads() {
      const res = await fetch('/api/downloads');
      if (!res.ok) throw new Error('Failed to fetch active downloads.');
      return res.json();
    },
    async retryDownload(hash) {
      const res = await fetch(`/api/downloads/${hash}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to retry torrent.');
      return res.json();
    },
    async removeDownload(hash, deleteFiles = false) {
      const res = await fetch(`/api/downloads/${hash}${deleteFiles ? '?deleteFiles=true' : ''}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove torrent.');
      return res.json();
    },
    async getSearchDebug() {
      const res = await fetch('/api/search-debug');
      if (!res.ok) throw new Error('Failed to fetch search diagnostics.');
      return res.json();
    },
    async getHistory() {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('Failed to fetch download history.');
      return res.json();
    },
    async clearHistory() {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear download history.');
      return res.json();
    },
    async deleteHistoryItem(id) {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete history item.');
      return res.json();
    },
    async getNotifications() {
      const res = await fetch('/api/anilist/notifications');
      if (!res.ok) return { notifications: [] };
      return res.json();
    }
  };

  // DOM Cache
  const DOM = {
    navTabs: document.querySelectorAll('.nav-tab'),
    viewPanels: document.querySelectorAll('.view-panel'),
    animeGrid: document.getElementById('anime-grid'),
    userDisplayName: document.getElementById('user-display-name'),
    logsBody: document.getElementById('logs-body'),
    logSelect: document.getElementById('log-select'),
    logLines: document.getElementById('log-lines'),
    logRefreshBtn: document.getElementById('log-refresh-btn'),
    settingsDialog: document.getElementById('settings-dialog'),
    nyaaDialog: document.getElementById('nyaa-dialog'),
    nyaaList: document.getElementById('nyaa-candidates-list'),
    mediaDetailModal: document.getElementById('media-detail-modal'),
    mediaDetailContent: document.getElementById('media-detail-content'),
    listEditorModal: document.getElementById('list-editor-modal'),
    settingsForm: document.getElementById('settings-form'),
    editMediaId: document.getElementById('edit-media-id'),
    editAltTitle: document.getElementById('edit-alt-title'),
    editStartEp: document.getElementById('edit-start-ep'),
    btnResetDownloads: document.getElementById('btn-reset-downloads'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    themeToggle: document.getElementById('theme-toggle'),
    hamburgerBtn: document.getElementById('hamburger-btn'),
    mobileMenu: document.getElementById('mobile-menu'),
    mobileNavTabs: document.querySelectorAll('.mobile-nav-tab'),
    configForm: document.getElementById('profile-config-form'),
    btnSubmitConfig: document.getElementById('btn-submit-config'),
    excludeReleaseGroupsInput: document.getElementById('excludeReleaseGroupsInput'),
    releaseGroupTierOverridesInput: document.getElementById('releaseGroupTierOverridesInput'),
    btnTestQbit: document.getElementById('btn-test-qbit'),
    btnTestProxy: document.getElementById('btn-test-proxy'),
    btnTestDiscord: document.getElementById('btn-test-discord'),
    logAutoRefresh: document.getElementById('log-auto-refresh'),
    downloadsPanel: document.getElementById('downloads-panel'),
    downloadsList: document.getElementById('downloads-list'),
    downloadsHeader: document.getElementById('downloads-header'),
    downloadsToggleIcon: document.getElementById('downloads-toggle-icon'),
    btnRefreshSearchDebug: document.getElementById('btn-refresh-search-debug'),
    searchDebugContainer: document.getElementById('search-debug-container'),
    historyList: document.getElementById('history-list'),
    historySearchInput: document.getElementById('history-search-input'),
    historyRefreshBtn: document.getElementById('history-refresh-btn'),
    historyClearBtn: document.getElementById('history-clear-btn'),
    notifBtn: document.getElementById('notif-btn'),
    notifBadge: document.getElementById('notif-badge'),
    notifDropdown: document.getElementById('notif-dropdown'),
    notifList: document.getElementById('notif-list'),
    btnMarkAllRead: document.getElementById('btn-mark-all-read'),
    btnRequestBrowserNotif: document.getElementById('btn-request-browser-notif'),
    prefTitleLang: document.getElementById('pref-title-lang')
  };

  // Light/Dark Theme Switcher
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }

  DOM.themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });

  // Hamburger Menu
  DOM.hamburgerBtn.addEventListener('click', () => {
    const menu = DOM.mobileMenu;
    const isOpen = menu.classList.contains('mobile-open');
    if (isOpen) {
      menu.classList.remove('mobile-open');
      menu.style.maxHeight = '0px';
      DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-bars text-lg';
      DOM.hamburgerBtn.setAttribute('aria-label', 'Open menu');
    } else {
      menu.classList.add('mobile-open');
      menu.style.maxHeight = menu.scrollHeight + 'px';
      DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-xmark text-lg';
      DOM.hamburgerBtn.setAttribute('aria-label', 'Close menu');
    }
  });

  // Modal Handlers
  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('opacity-0', 'pointer-events-none');
    const child = modal.firstElementChild;
    if (child) child.classList.remove('scale-95');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    const child = modal.firstElementChild;
    if (child) child.classList.add('scale-95');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('#settings-dialog, #nyaa-dialog, #media-detail-modal, #list-editor-modal');
      if (modal) closeModal(modal);
    });
  });

  // Notification Dropdown Toggle & Polling
  DOM.notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.notifDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (DOM.notifDropdown && !DOM.notifDropdown.contains(e.target) && e.target !== DOM.notifBtn) {
      DOM.notifDropdown.classList.add('hidden');
    }
  });

  DOM.btnMarkAllRead.addEventListener('click', () => {
    state.unreadNotifCount = 0;
    DOM.notifBadge.classList.add('hidden');
    DOM.notifBadge.textContent = '0';
    showToast('Notifications marked as read.');
  });

  DOM.btnRequestBrowserNotif.addEventListener('click', async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        showToast('Browser airing notifications enabled!');
      } else {
        showToast('Notification permission denied.', 'error');
      }
    }
  });

  async function pollNotifications() {
    try {
      const res = await API.getNotifications();
      if (res && res.notifications) {
        state.notifications = res.notifications;
        state.unreadNotifCount = res.notifications.filter(n => n.unread).length;
        if (state.unreadNotifCount > 0) {
          DOM.notifBadge.textContent = state.unreadNotifCount;
          DOM.notifBadge.classList.remove('hidden');
        } else {
          DOM.notifBadge.classList.add('hidden');
        }

        if (res.notifications.length > 0) {
          DOM.notifList.innerHTML = res.notifications.map(n => `
            <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                ${n.coverImage ? `<img src="${n.coverImage}" class="w-8 h-10 object-cover rounded-md" />` : '<i class="fa-solid fa-bell text-violet-500 text-sm"></i>'}
                <div>
                  <p class="font-bold text-slate-800 dark:text-slate-200">${n.title}</p>
                  <p class="text-[11px] text-slate-400">${n.message}</p>
                </div>
              </div>
              <button onclick="openMediaDetail(${n.mediaId})" class="px-2 py-1 bg-violet-600/10 text-violet-500 font-bold rounded-lg hover:bg-violet-600 hover:text-white transition-all text-[11px]">View</button>
            </div>
          `).join('');
        } else {
          // Replace the static placeholder so the empty state is explicit.
          DOM.notifList.innerHTML = '<p class="text-slate-400 text-center py-6">No new notifications</p>';
        }
      }
    } catch (e) {
      // Never leave a stale 'No new notifications' from a previous successful
      // poll — show the failure so the user knows the feed is unavailable.
      console.warn('Notifications poll error:', e);
      DOM.notifList.innerHTML = '<p class="text-rose-400 text-center py-6"><i class="fa-solid fa-circle-exclamation mr-1.5"></i>Failed to load notifications.</p>';
    }
  }

  // Title Language Preference Handler
  DOM.prefTitleLang.value = state.titleLanguage;
  DOM.prefTitleLang.addEventListener('change', () => {
    state.titleLanguage = DOM.prefTitleLang.value;
    localStorage.setItem('titleLanguage', state.titleLanguage);
    showToast(`Title language set to ${state.titleLanguage.toUpperCase()}`);
    // Refresh current view
    switchTab(state.activeTab);
  });

  // Tab Switcher Logic
  function switchTab(tabName) {
    state.activeTab = tabName;
    // Invalidate any in-flight async loaders from the previous tab.
    tabToken++;

    DOM.navTabs.forEach(btn => {
      const match = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active-tab', match);
      btn.classList.toggle('bg-violet-600', match);
      btn.classList.toggle('text-white', match);
      btn.classList.toggle('shadow-md', match);
      btn.classList.toggle('shadow-violet-500/25', match);
      if (match) {
        btn.setAttribute('aria-current', 'page');
        btn.classList.add('hover:bg-violet-700');
      } else {
        btn.removeAttribute('aria-current');
        btn.classList.remove('hover:bg-violet-700');
      }
    });

    const activeNavBtn = [...DOM.navTabs].find(b => b.getAttribute('data-tab') === tabName);
    if (activeNavBtn && activeNavBtn.offsetParent !== null) {
      activeNavBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    DOM.mobileNavTabs.forEach(btn => {
      const match = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('bg-violet-600/10', match);
      btn.classList.toggle('text-violet-700', match);
      btn.classList.toggle('dark:text-violet-300', match);
    });

    DOM.viewPanels.forEach(panel => {
      if (panel.id === `${tabName}-panel`) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    });

    // Close mobile menu on navigate
    if (DOM.mobileMenu && DOM.mobileMenu.classList.contains('mobile-open')) {
      DOM.mobileMenu.classList.remove('mobile-open');
      DOM.mobileMenu.style.maxHeight = '0px';
      if (DOM.hamburgerBtn) {
        const icon = DOM.hamburgerBtn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-bars text-lg';
        DOM.hamburgerBtn.setAttribute('aria-label', 'Open menu');
      }
    }

    // Trigger tab specific loader
    if (tabName === 'discover') loadDiscover();
    else if (tabName === 'watching') loadWatching();
    else if (tabName === 'lists') loadLists();
    else if (tabName === 'search') loadSearch();
    else if (tabName === 'social') loadSocial();
    else if (tabName === 'stats') loadStats();
    else if (tabName === 'history') loadHistory();
    else if (tabName === 'logs') {
      loadLogs();
      loadSearchDebug();
    }
    else if (tabName === 'settings') {
      loadSettings();
      loadAuthState();
    }
  }

  DOM.navTabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  DOM.mobileNavTabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));


  // ==========================================
  // TAB 1: DISCOVER HUB (RAILS & SEASONAL CHART)
  // ==========================================
  async function loadDiscover() {
    loadReleasingTodayFeed();
    loadRails();
    loadSeasonalChartGrid();
  }

  async function loadReleasingTodayFeed() {
    const feed = document.getElementById('releasing-today-feed');
    if (!feed) return;
    const token = tabToken;
    try {
      const res = await fetch('/api/anilist/airing-today?hours=24');
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to load schedule (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (isStaleTab(token)) return;
      const rawEntries = data.entries || [];
      const schedules = rawEntries.map(e => ({
        episode: e.episode,
        airingAt: e.airingAt,
        media: {
          id: e.mediaId,
          title: { romaji: e.romaji, english: e.english } || e.title,
          coverImage: { medium: e.coverImage }
        }
      }));
      if (schedules.length === 0) {
        feed.innerHTML = '<div class="text-slate-400 py-2">No titles from your list airing today.</div>';
        return;
      }
      // Dedupe re-runs / multiple daily slots: keep the earliest airing per media id.
      const seenMedia = new Set();
      const unique = schedules.filter(s => {
        if (seenMedia.has(s.media.id)) return false;
        seenMedia.add(s.media.id);
        return true;
      });
      feed.innerHTML = unique.map(s => {
        const title = formatTitle(s.media.title);
        const coverUrl = (s.media.coverImage && s.media.coverImage.medium) || '';
        const hoursLeft = Math.max(0, Math.round((s.airingAt - Date.now() / 1000) / 3600));
        // AniList can report negative episode numbers for re-runs; clamp them.
        const epLabel = s.episode > 0 ? `Ep ${s.episode}` : 'Ep ?';
        return `
          <div onclick="openMediaDetail(${s.media.id})" class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shrink-0 cursor-pointer hover:border-violet-500 transition-all">
            <img src="${coverUrl}" class="w-8 h-10 object-cover rounded-lg" />
            <div>
              <p class="font-bold text-slate-800 dark:text-slate-200 line-clamp-1 max-w-[140px]">${title}</p>
              <p class="text-[10px] text-violet-400 font-semibold">${epLabel} ${hoursLeft > 0 ? `in ~${hoursLeft}h` : 'Airing soon'}</p>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      if (isStaleTab(token)) return;
      feed.innerHTML = '<div class="text-slate-400 py-2">Failed to load schedule.</div>';
    }
  }

  async function loadRails() {
    const rails = [
      { id: 'rail-trending', sort: 'TRENDING_DESC', sparkline: true },
      { id: 'rail-popular-season', sort: 'POPULARITY_DESC', season: getCurrentSeason().season, year: getCurrentSeason().year },
      { id: 'rail-upcoming', sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED' },
      { id: 'rail-all-time', sort: 'POPULARITY_DESC' },
      { id: 'rail-top-100', sort: 'SCORE_DESC' }
    ];
    const token = tabToken;

    for (const r of rails) {
      const container = document.getElementById(r.id);
      if (!container) continue;
      try {
        const query = `
          query ($sort: [MediaSort], $status: MediaStatus, $season: MediaSeason, $seasonYear: Int) {
            Page(page: 1, perPage: 10) {
              media(type: ANIME, sort: $sort, status: $status, season: $season, seasonYear: $seasonYear) {
                id
                title { romaji english native }
                coverImage { extraLarge large }
                averageScore
                format
                episodes
                trending
                mediaListEntry { progress status }
              }
            }
          }
        `;
        const data = await queryAniList(query, { sort: [r.sort], status: r.status, season: r.season, seasonYear: r.year });
        if (isStaleTab(token)) return;
        const items = data.Page.media || [];
        container.innerHTML = items.map(m => renderRailCard(m, r.sparkline)).join('');
      } catch (e) {
        if (isStaleTab(token)) return;
        container.innerHTML = '<div class="text-slate-400 text-xs py-4">Failed to fetch rail items.</div>';
      }
    }
  }

  function renderRailCard(media, showSparkline = false) {
    const title = formatTitle(media.title);
    const score = media.averageScore ? `${media.averageScore}%` : 'N/A';
    const isDownloaded = state.animeList.some(a => a.mediaId === media.id);
    const coverUrl = (media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || '';

    // Sparkline SVG path generator
    let sparklineSvg = '';
    if (showSparkline) {
      const points = [10, 25, 18, 35, 28, 45, 40, 60, media.trending ? Math.min(90, media.trending / 10) : 55];
      const svgPath = points.map((val, idx) => `${idx * 12},${60 - val}`).join(' L ');
      sparklineSvg = `
        <div class="absolute bottom-2 right-2 w-16 h-8 opacity-60">
          <svg viewBox="0 0 100 60" class="w-full h-full stroke-violet-400 fill-none stroke-[3]">
            <path d="M ${svgPath}" />
          </svg>
        </div>
      `;
    }

    return `
      <div onclick="openMediaDetail(${media.id})" class="group relative flex-none w-40 sm:w-44 rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-md hover:scale-[1.03] transition-transform duration-300 cursor-pointer">
        <div class="aspect-[2/3] w-full relative overflow-hidden">
          <img src="${coverUrl}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent"></div>

          <!-- Badges -->
          <div class="absolute top-2 left-2 flex flex-col gap-1">
            <span class="px-2 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md text-[10px] font-bold text-amber-400">
              <i class="fa-solid fa-star text-[9px] mr-1"></i>${score}
            </span>
            ${isDownloaded ? '<span class="px-2 py-0.5 rounded-lg bg-emerald-600/90 text-[10px] font-bold text-white"><i class="fa-solid fa-check mr-1"></i>In List</span>' : ''}
          </div>

          ${sparklineSvg}

          <div class="absolute bottom-3 left-3 right-3 space-y-1">
            <span class="text-[10px] font-bold uppercase tracking-wider text-violet-400">${media.format || 'TV'}</span>
            <h4 class="font-['Outfit'] font-bold text-xs text-white line-clamp-2 leading-snug">${title}</h4>
          </div>
        </div>
      </div>
    `;
  }

  // Seasonal Chart Grid & Tabs
  document.querySelectorAll('.discover-season-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.discover-season-btn').forEach(b => {
        b.classList.remove('bg-violet-600', 'text-white');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('bg-violet-600', 'text-white');
      btn.classList.remove('text-slate-400');
      state.discoverSeason = btn.getAttribute('data-season-tab');
      loadSeasonalChartGrid();
    });
  });

  // Activate the real current season chip on load (markup has no hardcoded active).
  const currentSeasonBtn = document.querySelector(
    `.discover-season-btn[data-season-tab="${state.discoverSeason}"]`
  );
  if (currentSeasonBtn) {
    currentSeasonBtn.classList.add('bg-violet-600', 'text-white');
    currentSeasonBtn.classList.remove('text-slate-400');
  }

  document.querySelectorAll('.chart-subtab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chart-subtab').forEach(b => {
        b.classList.remove('bg-violet-600', 'text-white');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('bg-violet-600', 'text-white');
      btn.classList.remove('text-slate-400');
      state.discoverChartTab = btn.getAttribute('data-chart-subtab');
      loadSeasonalChartGrid();
    });
  });

  const hideMyListToggle = document.getElementById('hide-my-list-toggle');
  if (hideMyListToggle) {
    hideMyListToggle.addEventListener('change', () => {
      state.hideOnMyList = hideMyListToggle.checked;
      loadSeasonalChartGrid();
    });
  }

  async function loadSeasonalChartGrid() {
    const grid = document.getElementById('seasonal-chart-grid');
    if (!grid) return;
    const token = tabToken;

    try {
      const [season, year] = state.discoverSeason.split('_');
      // Map chart subtab -> AniList status filter. Upcoming/TBA both use
      // NOT_YET_RELEASED and are split client-side by whether an air date exists.
      const subtabStatus = {
        Airing: 'RELEASING',
        Upcoming: 'NOT_YET_RELEASED',
        TBA: 'NOT_YET_RELEASED',
        Archive: 'FINISHED'
      };
      const status = subtabStatus[state.discoverChartTab] || 'RELEASING';
      const query = `
        query ($season: MediaSeason, $seasonYear: Int, $status: MediaStatus) {
          Page(page: 1, perPage: 24) {
            media(season: $season, seasonYear: $seasonYear, status: $status, type: ANIME, sort: POPULARITY_DESC) {
              id
              title { romaji english native }
              coverImage { extraLarge large }
              averageScore
              episodes
              format
              nextAiringEpisode { episode timeUntilAiring }
              mediaListEntry { status progress }
            }
          }
        }
      `;
      const data = await queryAniList(query, { season, seasonYear: parseInt(year), status });
      if (isStaleTab(token)) return;
      let items = data.Page.media || [];

      // Split NOT_YET_RELEASED shows: Upcoming has a scheduled air time,
      // TBA has none yet.
      if (state.discoverChartTab === 'Upcoming') {
        items = items.filter(i => i.nextAiringEpisode);
      } else if (state.discoverChartTab === 'TBA') {
        items = items.filter(i => !i.nextAiringEpisode);
      }

      if (state.hideOnMyList) {
        const onListIds = new Set(state.animeList.map(a => a.mediaId));
        items = items.filter(i => !onListIds.has(i.id) && !i.mediaListEntry);
      }

      if (items.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400 text-sm">No items found for this seasonal chart selection.</div>';
        return;
      }

      grid.innerHTML = items.map(m => {
        const title = formatTitle(m.title);
        const score = m.averageScore ? `${m.averageScore}%` : 'N/A';
        const coverUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '';
        const nextEp = m.nextAiringEpisode;
        let countdownStr = 'TBA';
        if (nextEp) {
          const days = Math.floor(nextEp.timeUntilAiring / 86400);
          const hours = Math.floor((nextEp.timeUntilAiring % 86400) / 3600);
          countdownStr = `Ep ${nextEp.episode} in ${days}d ${hours}h`;
        }

        const isLocalWatch = state.animeList.some(a => a.mediaId === m.id);

        return `
          <div onclick="openMediaDetail(${m.id})" class="group p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 hover:border-violet-500 transition-all cursor-pointer flex gap-3.5 shadow-sm">
            <img src="${coverUrl}" class="w-20 h-28 object-cover rounded-xl shrink-0 group-hover:scale-105 transition-transform" />
            <div class="flex flex-col justify-between flex-grow">
              <div class="space-y-1">
                <span class="text-[10px] font-bold uppercase tracking-wider text-violet-400">${m.format || 'TV'}</span>
                <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-100 line-clamp-2">${title}</h4>
              </div>
              <div class="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[11px]">
                <div class="flex items-center justify-between font-semibold">
                  <span class="text-amber-400"><i class="fa-solid fa-star mr-1"></i>${score}</span>
                  <span class="text-slate-400">${m.episodes ? `${m.episodes} eps` : '? eps'}</span>
                </div>
                <div class="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md inline-block">
                  ${countdownStr}
                </div>
                ${isLocalWatch ? '<span class="text-[10px] font-bold text-violet-400 block"><i class="fa-solid fa-download mr-1"></i>Downloaded</span>' : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

    } catch (e) {
      if (isStaleTab(token)) return;
      grid.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400 text-sm">Failed to load seasonal chart grid.</div>';
    }
  }


  // ==========================================
  // TAB 2: WATCHING (LOCAL WATCHLIST & SCHEDULER)
  // ==========================================
  async function loadWatching() {
    const token = tabToken;
    try {
      const res = await API.getAnime();
      if (isStaleTab(token)) return;
      state.userName = res.userName || '';
      state.animeList = res.anime || [];

      if (DOM.userDisplayName) DOM.userDisplayName.textContent = state.userName || 'Otaku';
      renderAnimeGrid(state.animeList);
      loadActiveDownloads();
    } catch (e) {
      if (isStaleTab(token)) return;
      // Clear stale state so the previous user's list is never shown after an
      // API failure — render an explicit error/empty state instead.
      state.userName = '';
      state.animeList = [];
      if (DOM.userDisplayName) DOM.userDisplayName.textContent = 'Otaku';
      if (DOM.animeGrid) {
        DOM.animeGrid.innerHTML = `
          <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400">
            <i class="fa-solid fa-triangle-exclamation text-4xl mb-4 text-rose-500"></i>
            <p class="font-semibold text-sm">Failed to load your watching list.</p>
            <p class="text-xs mt-1">${e.message}</p>
          </div>
        `;
      }
      showToast(e.message, 'error');
    }
  }

  function renderAnimeGrid(list) {
    if (!DOM.animeGrid) return;
    if (!list || list.length === 0) {
      DOM.animeGrid.innerHTML = `
        <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-tv text-4xl mb-4 text-violet-500"></i>
          <p class="font-semibold text-sm">No watching entries found on AniList.</p>
        </div>
      `;
      return;
    }

    DOM.animeGrid.innerHTML = list.map(item => {
      const media = item.media || {};
      const mediaId = item.mediaId;
      const title = media.alternativeTitle || formatTitle(media.title);
      const cover = media.coverImage?.extraLarge || media.coverImage?.medium || '';
      const totalEp = media.episodes || '?';
      const progress = item.progress || 0;
      // Incomplete records may lack downloadedEpisodes — always fall back to
      // an empty array so the Local Download State section renders every time.
      const downloaded = Array.isArray(item.downloadedEpisodes) ? item.downloadedEpisodes : [];
      const hasCover = !!cover;

      return `
        <div class="group relative rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-[#111827]/80 overflow-hidden shadow-sm hover:shadow-xl hover:border-violet-500/50 transition-all duration-300 flex flex-col">
          <div class="aspect-[16/9] w-full relative overflow-hidden bg-slate-900">
            ${hasCover
              ? `<img src="${cover}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.style.display='none'" />`
              : '<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900"><i class="fa-solid fa-tv text-3xl text-slate-600"></i></div>'
            }
            <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-transparent to-transparent"></div>

            <div class="absolute top-3 left-3 right-3 flex items-center justify-between">
              <span class="px-2.5 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md text-xs font-bold text-violet-400">
                Ep ${progress} / ${totalEp}
              </span>
              ${mediaId != null ? `<button onclick="openAnimeSettings(${mediaId})" class="w-8 h-8 rounded-xl bg-slate-950/80 backdrop-blur-md text-slate-300 hover:text-white flex items-center justify-center transition-colors">
                <i class="fa-solid fa-gear text-xs"></i>
              </button>` : ''}
            </div>
          </div>

          <div class="p-5 flex flex-col justify-between flex-grow space-y-4">
            <div>
              <h3 ${mediaId != null ? `onclick="openMediaDetail(${mediaId})"` : ''} class="font-['Outfit'] font-bold text-base text-slate-900 dark:text-white line-clamp-1 ${mediaId != null ? 'cursor-pointer hover:text-violet-400 transition-colors' : ''}">${title}</h3>
              <p class="text-xs text-slate-400 mt-1 line-clamp-2">${media.description ? media.description.replace(/<[^>]*>?/gm, '') : 'No description available.'}</p>
            </div>

            <!-- Downloaded Badge Pills -->
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-slate-400">
                <span class="font-semibold">Local Download State</span>
                <span class="text-emerald-400 font-bold">${downloaded.length} Cached</span>
              </div>
              <div class="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                ${downloaded.length > 0 ? downloaded.map(ep => `<span class="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">Ep ${ep}</span>`).join('') : '<span class="text-[11px] text-slate-500 italic">No episodes cached locally</span>'}
              </div>
            </div>

            <!-- Action buttons -->
            <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              ${mediaId != null ? `<button onclick="openNyaaDialog(${mediaId})" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-md shadow-violet-500/20 transition-all flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-magnifying-glass"></i>Nyaa Search
              </button>
              <button onclick="openMediaDetail(${mediaId})" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-circle-info"></i>Details
              </button>` : '<span class="col-span-full text-[11px] text-slate-500 italic">Incomplete record — no media actions available.</span>'}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Downloads panel collapse toggle — header click hides/shows the list and
  // rotates the chevron.
  DOM.downloadsHeader?.addEventListener('click', () => {
    downloadsCollapsed = !downloadsCollapsed;
    if (DOM.downloadsList) DOM.downloadsList.classList.toggle('hidden', downloadsCollapsed);
    if (DOM.downloadsToggleIcon) {
      DOM.downloadsToggleIcon.classList.toggle('fa-chevron-up', !downloadsCollapsed);
      DOM.downloadsToggleIcon.classList.toggle('fa-chevron-down', downloadsCollapsed);
    }
  });

  // Human-readable ETA from qBittorrent's seconds-remaining field.
  // qBittorrent reports 8640000 (100 days) as the "invalid/unknown ETA"
  // sentinel and -1 for unknown — never render those as real ETAs.
  function formatEta(seconds) {
    if (!seconds || seconds <= 0 || seconds >= 8640000) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return ` | ETA ${h}h ${m}m`;
    if (m > 0) return ` | ETA ${m}m`;
    return ` | ETA ${seconds}s`;
  }

  async function loadActiveDownloads() {
    const token = tabToken;
    try {
      const downloads = await API.getDownloads();
      if (isStaleTab(token)) return;
      if (!DOM.downloadsPanel) return;
      if (downloads && downloads.length > 0) {
        DOM.downloadsPanel.classList.remove('hidden');
        DOM.downloadsList.innerHTML = downloads.map(d => {
          const kind = d.statusKind || 'unknown';
          const label = d.statusLabel || d.state || 'Unknown';
          const badgeClass = {
            downloading: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
            stalled: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
            checking: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
            queued: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
            paused: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
            stopped: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
            complete: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
            seeding: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
            error: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
          }[kind] || 'bg-slate-500/15 text-slate-400 border-slate-500/30';
          const pct = Math.min(100, Math.max(0, (d.progress || 0) * 100)).toFixed(1);
          const speed = d.dlspeed ? ` | ${(d.dlspeed / 1024 / 1024).toFixed(1)} MB/s down` : '';
          const eta = formatEta(d.eta);
          const retryable = ['stopped', 'paused', 'error', 'queued', 'stalled', 'checking'].includes(kind);
          const hash = d.hash || '';
          return `
            <div class="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-sky-500/20 flex items-center justify-between gap-3 text-xs">
              <div class="space-y-0.5 min-w-0">
                <p class="font-bold text-slate-800 dark:text-slate-200 truncate" title="${(d.name || '').replace(/"/g, '&quot;')}">${d.name || '(unnamed torrent)'}</p>
                <p class="text-sky-400 font-mono">${pct}%${speed}${eta}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="px-2.5 py-1 rounded-xl border font-bold uppercase tracking-wider text-[10px] ${badgeClass}">${label}</span>
                ${hash ? `
                  ${retryable ? `<button onclick="retryTorrent('${hash}')" class="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500 border border-amber-500/20 hover:text-white text-amber-400 font-bold text-[10px] uppercase transition-colors cursor-pointer" title="Resume / retry"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
                  <button onclick="removeTorrent('${hash}')" class="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500 border border-rose-500/20 hover:text-white text-rose-400 font-bold text-[10px] uppercase transition-colors cursor-pointer" title="Remove from queue (keeps files on disk)"><i class="fa-solid fa-trash"></i></button>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');
      } else {
        DOM.downloadsPanel.classList.add('hidden');
      }
    } catch (e) {
      console.warn('Failed to load active downloads:', e);
    }
  }

  window.retryTorrent = async function (hash) {
    try {
      const res = await fetch(`/api/downloads/${hash}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to retry torrent.');
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'Torrent resumed.', 'success');
      loadActiveDownloads();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  window.removeTorrent = async function (hash) {
    if (!confirm('Remove this torrent from the queue? Files on disk are kept.')) return;
    try {
      await API.removeDownload(hash);
      showToast('Torrent removed.', 'success');
      loadActiveDownloads();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };


  // ==========================================
  // TAB 3: LISTS (FULL ANILIST COLLECTION)
  // ==========================================
  // Fetch the user's full AniList collection once per session so list
  // membership is known from the first page load (detail badges, editor
  // prefill) without requiring a visit to the Lists tab.
  let listEntriesLoadPromise = null;
  async function ensureListEntriesLoaded() {
    if (state.listEntriesLoaded) return true;
    if (!listEntriesLoadPromise) {
      listEntriesLoadPromise = (async () => {
        try {
          const params = new URLSearchParams({ userName: state.userName || '', type: 'ANIME' });
          const res = await fetch(`/api/anilist/user-list?${params.toString()}`);
          if (!res.ok) return false;
          const data = await res.json();
          const collections = data.lists || [];
          state.listEntriesByMedia = {};
          collections.forEach(l => (l.entries || []).forEach(e => { state.listEntriesByMedia[e.mediaId] = e; }));
          state.listEntriesLoaded = true;
          return true;
        } catch { return false; }
      })();
    }
    try { return await listEntriesLoadPromise; } finally { listEntriesLoadPromise = null; }
  }

  async function loadLists() {
    loadUserListsData();
  }

  async function loadUserListsData() {
    const container = document.getElementById('lists-entries-container');
    if (!container) return;
    const token = tabToken;

    try {
      // Fetch via the backend so the server-side AniList token is used —
      // the browser has no token (/api/config strips bearerTokenAnilist),
      // so a direct browser->AniList query returns 'Private User' empty lists.
      const params = new URLSearchParams({
        userName: state.userName || '',
        type: state.listsMediaType || 'ANIME',
      });
      const res = await fetch(`/api/anilist/user-list?${params.toString()}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to load user list (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (isStaleTab(token)) return;
      const collections = data.lists || [];

      let allEntries = [];
      // Map mediaId -> list entry for the editor's prefill / delete flows.
      state.listEntriesByMedia = {};
      collections.forEach(l => {
        l.entries.forEach(e => {
          allEntries.push({ ...e, listName: l.name });
          state.listEntriesByMedia[e.mediaId] = e;
        });
      });
      state.listEntriesLoaded = true;

      // Filter by status group
      if (state.listsStatusGroup !== 'ALL') {
        allEntries = allEntries.filter(e => e.status === state.listsStatusGroup || e.listName === state.listsStatusGroup);
      }

      // Filter by search input
      const searchVal = (document.getElementById('lists-search-input')?.value || '').toLowerCase();
      if (searchVal) {
        allEntries = allEntries.filter(e => formatTitle(e.media.title).toLowerCase().includes(searchVal));
      }

      // Sort
      const sortVal = document.getElementById('lists-sort-select')?.value || 'score';
      allEntries.sort((a, b) => {
        if (sortVal === 'score') return (b.score || 0) - (a.score || 0);
        if (sortVal === 'title') return formatTitle(a.media.title).localeCompare(formatTitle(b.media.title));
        if (sortVal === 'progress') return (b.progress || 0) - (a.progress || 0);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

      // Update status counts
      ['ALL', 'CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING'].forEach(st => {
        const el = document.getElementById(`cnt-${st.toLowerCase()}`);
        if (el) {
          if (st === 'ALL') el.textContent = allEntries.length;
          else el.textContent = allEntries.filter(e => e.status === st).length;
        }
      });

      if (allEntries.length === 0) {
        container.innerHTML = '<div class="py-16 text-center text-slate-400 text-sm">No collection entries found for this filter.</div>';
        return;
      }

      if (state.listsViewMode === 'compact') {
        container.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase">
                  <th class="py-3 px-4">Title</th>
                  <th class="py-3 px-4">Progress</th>
                  <th class="py-3 px-4">Score</th>
                  <th class="py-3 px-4">Status</th>
                  <th class="py-3 px-4 text-right">Quick Edit</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 font-semibold">
                ${allEntries.map(e => `
                  <tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                    <td class="py-3 px-4 flex items-center gap-3">
                      <img src="${e.media.coverImage.large}" class="w-8 h-10 object-cover rounded-lg" />
                      <span onclick="openMediaDetail(${e.media.id})" class="cursor-pointer hover:text-violet-400">${formatTitle(e.media.title)}</span>
                    </td>
                    <td class="py-3 px-4">${e.progress} / ${e.media.episodes || e.media.chapters || '?'}</td>
                    <td class="py-3 px-4 text-amber-400 font-bold">${e.score ? `${e.score}%` : 'N/A'}</td>
                    <td class="py-3 px-4"><span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-bold">${e.status}</span></td>
                    <td class="py-3 px-4 text-right">
                      <button onclick="quickIncrementProgress(${e.media.id}, ${e.progress})" class="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-bold text-[11px] hover:bg-violet-700">+1 Ep</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            ${allEntries.map(e => `
              <div class="group p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 hover:border-violet-500 transition-all shadow-sm flex flex-col justify-between">
                <div class="flex gap-3">
                  <img src="${e.media.coverImage.large}" class="w-20 h-28 object-cover rounded-xl shrink-0 cursor-pointer" onclick="openMediaDetail(${e.media.id})" />
                  <div class="space-y-1 flex-grow">
                    <h4 onclick="openMediaDetail(${e.media.id})" class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-100 line-clamp-2 cursor-pointer hover:text-violet-400">${formatTitle(e.media.title)}</h4>
                    <span class="inline-block px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-[10px] font-bold">${e.status}</span>
                    <p class="text-xs text-slate-400 font-semibold pt-1">Ep ${e.progress} / ${e.media.episodes || '?'}</p>
                    <p class="text-xs text-amber-400 font-bold"><i class="fa-solid fa-star text-[10px] mr-1"></i>${e.score ? `${e.score}%` : 'N/A'}</p>
                  </div>
                </div>

                <div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 mt-3">
                  <button onclick="quickIncrementProgress(${e.media.id}, ${e.progress})" class="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs transition-all shadow-sm">
                    +1 Watched
                  </button>
                  <button onclick="openListEditor(${e.media.id}, ${e.id})" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all">
                    Edit
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

    } catch (e) {
      container.innerHTML = '<div class="py-16 text-center text-slate-400 text-sm">Failed to load AniList user collection.</div>';
    }
  }

  // Quick Progress Increment Handler
  window.quickIncrementProgress = async function(mediaId, currentEp) {
    // Routed through the backend so the server-side AniList token authorizes
    // the mutation (the browser never holds bearerTokenAnilist).
    try {
      const newEp = currentEp + 1;
      await saveListEntryViaBackend({ mediaId, progress: newEp });
      if (state.listEntriesByMedia[mediaId]) {
        state.listEntriesByMedia[mediaId].progress = newEp;
      }
      showToast(`Updated progress to Episode ${newEp}!`);
      loadUserListsData();
      if (state.activeMediaDetail && state.activeMediaDetail.id === mediaId) {
        openMediaDetail(mediaId);
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // Lists Status & View Mode Event Listeners
  document.querySelectorAll('.list-status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.list-status-tab').forEach(b => {
        b.classList.remove('bg-violet-600', 'text-white');
        b.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-400');
      });
      btn.classList.add('bg-violet-600', 'text-white');
      btn.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'text-slate-400');
      state.listsStatusGroup = btn.getAttribute('data-status-group');
      loadUserListsData();
    });
  });

  document.querySelectorAll('.list-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.listsViewMode = btn.getAttribute('data-list-view');
      loadUserListsData();
    });
  });

  document.getElementById('lists-media-type-anime')?.addEventListener('click', () => {
    state.listsMediaType = 'ANIME';
    loadUserListsData();
  });
  document.getElementById('lists-media-type-manga')?.addEventListener('click', () => {
    state.listsMediaType = 'MANGA';
    loadUserListsData();
  });

  document.getElementById('lists-search-input')?.addEventListener('input', () => loadUserListsData());
  document.getElementById('lists-sort-select')?.addEventListener('change', () => loadUserListsData());


  // ==========================================
  // TAB 4: SEARCH (DEBOUNCED SEARCH & FILTERS)
  // ==========================================
  let searchDebounceTimer = null;
  const searchInput = document.getElementById('global-search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const filterOnListEl = document.getElementById('filter-on-list');

  // Media ids on the user's AniList collection, lazily fetched via the backend
  // (server-side token) and cached for the session per media type. Powers the
  // 'On List' search filter; only meaningful for ANIME/MANGA entity searches.
  // Fetches ONLY the type being searched (never both) so the filter stays fast.
  const myListMediaIdsCache = {}; // type -> Set<mediaId>
  async function getMyListMediaIds(type) {
    const entityType = type || state.searchEntity || 'ANIME';
    if (myListMediaIdsCache[entityType]) return myListMediaIdsCache[entityType];
    const ids = new Set();
    try {
      const params = new URLSearchParams({ userName: state.userName || '', type: entityType, perChunk: 500 });
      const res = await fetch(`/api/anilist/user-list?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        (data.lists || []).forEach(l => (l.entries || []).forEach(e => ids.add(e.mediaId)));
      }
    } catch (e) {
      // Leave the set empty — the filter then matches nothing, which is the
      // honest outcome when the collection can't be resolved.
    }
    myListMediaIdsCache[entityType] = ids;
    return ids;
  }

  // 'On List' applies to media searches only; disable it on entity tabs where
  // a user collection membership is meaningless.
  function updateFilterOnListAvailability() {
    if (!filterOnListEl) return;
    const mediaEntity = state.searchEntity === 'ANIME' || state.searchEntity === 'MANGA';
    filterOnListEl.disabled = !mediaEntity;
    filterOnListEl.classList.toggle('opacity-40', !mediaEntity);
  }
  if (searchInput) {
    // Show the clear (X) button only while the query is non-empty.
    if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !searchInput.value.trim());
    searchInput.addEventListener('input', () => {
      if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !searchInput.value.trim());
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.searchQuery = searchInput.value.trim();
        state.searchPage = 1;
        loadSearchResults();
      }, 350);
    });
    // Clear button resets the query and re-runs the search.
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchClearBtn.classList.add('hidden');
        state.searchQuery = '';
        state.searchPage = 1;
        loadSearchResults();
        searchInput.focus();
      });
    }
  }

  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    const drawer = document.getElementById('search-filter-drawer');
    if (drawer) drawer.classList.toggle('hidden');
  });

  // Any filter change re-runs the search immediately (page 1) so the filter
  // drawer is never inert — no need to retype the query.
  ['filter-format', 'filter-status', 'filter-season', 'filter-year', 'filter-genre', 'filter-on-list'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.searchPage = 1;
      loadSearchResults();
    });
  });

  document.querySelectorAll('.search-entity-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.search-entity-tab').forEach(b => {
        b.classList.remove('bg-violet-600', 'text-white');
        b.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-400');
      });
      btn.classList.add('bg-violet-600', 'text-white');
      btn.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'text-slate-400');
      state.searchEntity = btn.getAttribute('data-entity-tab');
      state.searchPage = 1;
      updateFilterOnListAvailability();
      loadSearchResults();
    });
  });

  // Discover rail 'View All' buttons: jump to Search with the rail's sort applied.
  document.querySelectorAll('[data-tab="search"][data-search-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.searchSort = btn.getAttribute('data-search-sort') || 'POPULARITY_DESC';
      state.searchPage = 1;
      switchTab('search');
    });
  });

  async function loadSearch() {
    updateFilterOnListAvailability();
    loadSearchResults();
  }

  // Toggles the Load More pagination row based on whether another page exists.
  function updateSearchPagination() {
    const pagination = document.getElementById('search-pagination');
    if (!pagination) return;
    pagination.classList.toggle('hidden', !state.searchHasNext || state.searchResults.length === 0);
  }

  async function loadSearchResults(append = false) {
    const grid = document.getElementById('search-results-grid');
    if (!grid) return;
    const token = tabToken;

    try {
      const entity = state.searchEntity;
      if (entity === 'ANIME' || entity === 'MANGA') {
        const query = `
          query ($search: String, $page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat, $status: MediaStatus, $season: MediaSeason, $seasonYear: Int, $genre: String, $sort: [MediaSort]) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { hasNextPage }
              media(search: $search, type: $type, format: $format, status: $status, season: $season, seasonYear: $seasonYear, genre: $genre, sort: $sort) {
                id
                title { romaji english native }
                coverImage { extraLarge large }
                averageScore
                format
                episodes
                chapters
              }
            }
          }
        `;
        const vars = {
          search: state.searchQuery || undefined,
          page: state.searchPage,
          perPage: 20,
          type: entity,
          sort: state.searchSort || 'POPULARITY_DESC',
          format: document.getElementById('filter-format')?.value || undefined,
          status: document.getElementById('filter-status')?.value || undefined,
          season: document.getElementById('filter-season')?.value || undefined,
          seasonYear: document.getElementById('filter-year')?.value ? parseInt(document.getElementById('filter-year').value) : undefined,
          genre: document.getElementById('filter-genre')?.value || undefined
        };

        const data = await queryAniList(query, vars);
        if (isStaleTab(token)) return;
        let mediaList = data.Page.media || [];
        state.searchHasNext = data.Page.pageInfo.hasNextPage;

        // 'On List' client-side filter: keep only media present in (or absent
        // from) the user's AniList collection. Because this filter is applied
        // AFTER AniList returns a page, a strict filter (e.g. "not on my list"
        // over a mostly-watched genre) can starve the grid to 1-2 cards. Keep
        // fetching subsequent pages (bounded) until the grid has enough cards
        // or the API reports no more pages.
        const onListVal = document.getElementById('filter-on-list')?.value || '';
        if (onListVal) {
          const myIds = await getMyListMediaIds(entity);
          if (isStaleTab(token)) return;
          const filterPage = (items) => items.filter(m => onListVal === 'true' ? myIds.has(m.id) : !myIds.has(m.id));
          mediaList = filterPage(mediaList);
          let probePage = state.searchPage + 1;
          const maxProbePages = 5; // bound the extra AniList round-trips
          while (mediaList.length < 20 && state.searchHasNext && probePage <= state.searchPage + maxProbePages) {
            const probeVars = { ...vars, page: probePage };
            const probeData = await queryAniList(query, probeVars);
            if (isStaleTab(token)) return;
            mediaList = mediaList.concat(filterPage(probeData.Page.media || []));
            state.searchHasNext = probeData.Page.pageInfo.hasNextPage;
            probePage += 1;
          }
        }

        if (!append) state.searchResults = [];

        if (mediaList.length === 0 && state.searchResults.length === 0) {
          grid.innerHTML = '<div class="col-span-full py-16 text-center text-slate-400 text-sm">No search results found.</div>';
          updateSearchPagination();
          return;
        }

        const cards = mediaList.map(m => {
          const title = formatTitle(m.title);
          const score = m.averageScore ? `${m.averageScore}%` : 'N/A';
          const coverUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '';
          const isDownloaded = state.animeList.some(a => a.mediaId === m.id);

          return `
            <div onclick="openMediaDetail(${m.id})" class="group rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 overflow-hidden hover:border-violet-500 transition-all cursor-pointer flex flex-col shadow-sm">
              <div class="aspect-[2/3] w-full relative overflow-hidden bg-slate-950">
                <img src="${coverUrl}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <div class="absolute top-2 left-2 flex flex-col gap-1">
                  <span class="px-2 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md text-[10px] font-bold text-amber-400">
                    <i class="fa-solid fa-star text-[9px] mr-1"></i>${score}
                  </span>
                  ${isDownloaded ? '<span class="px-2 py-0.5 rounded-lg bg-emerald-600/90 text-[10px] font-bold text-white"><i class="fa-solid fa-check mr-1"></i>Downloaded</span>' : ''}
                </div>
              </div>
              <div class="p-3 space-y-1 flex-grow flex flex-col justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-violet-400">${m.format || 'TV'}</span>
                <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-100 line-clamp-2">${title}</h4>
              </div>
            </div>
          `;
        });
        state.searchResults = state.searchResults.concat(cards);
        grid.innerHTML = state.searchResults.join('');
        updateSearchPagination();

      } else {
        // Entity search for CHARACTER / STAFF / STUDIO / USER — query AniList
        // for the entity type directly and render name-based result cards.
        const entityField = {
          CHARACTER: 'characters',
          STAFF: 'staff',
          STUDIO: 'studios',
          USER: 'users'
        }[entity];
        // Field shape differs per entity: Character/Staff expose an object
        // `name { full native }` + `image`, User exposes a plain `name` string +
        // `avatar`, Studio exposes a plain `name` string and no artwork.
        const nameField = (entity === 'CHARACTER' || entity === 'STAFF') ? 'name { full native }' : 'name';
        const imgField = entity === 'USER' ? 'avatar { large medium }' : 'image { large medium }';
        const query = `
          query ($search: String, $page: Int, $perPage: Int) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { hasNextPage }
              ${entityField}(search: $search) {
                id
                ${nameField}
                ${entity === 'STUDIO' ? '' : imgField}
              }
            }
          }
        `;
        const data = await queryAniList(query, {
          search: state.searchQuery || undefined,
          page: state.searchPage,
          perPage: 20
        });
        if (isStaleTab(token)) return;
        const results = data.Page[entityField] || [];
        state.searchHasNext = data.Page.pageInfo.hasNextPage;

        if (!append) state.searchResults = [];

        if (results.length === 0 && state.searchResults.length === 0) {
          grid.innerHTML = '<div class="col-span-full py-16 text-center text-slate-400 text-sm">No search results found.</div>';
          updateSearchPagination();
          return;
        }

        const siteBase = {
          CHARACTER: 'character',
          STAFF: 'staff',
          STUDIO: 'studio',
          USER: 'user'
        }[entity];

        const cards = results.map(r => {
          // Character/Staff return name objects; User/Studio return plain strings.
          const name = typeof r.name === 'object' && r.name
            ? (r.name.full || r.name.native || 'Unknown')
            : (r.name || 'Unknown');
          const art = r.image || r.avatar;
          const img = art && (art.large || art.medium) ? (art.large || art.medium) : '';
          const profileUrl = siteBase === 'user' ? `https://anilist.co/user/${encodeURIComponent(name)}` : `https://anilist.co/${siteBase}/${r.id}`;
          return `
            <a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="group rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 overflow-hidden hover:border-violet-500 transition-all cursor-pointer flex flex-col shadow-sm">
              <div class="aspect-[2/3] w-full relative overflow-hidden bg-slate-950">
                ${img ? `<img src="${img}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />` : '<div class="w-full h-full flex items-center justify-center text-slate-600"><i class="fa-solid fa-user text-4xl"></i></div>'}
                <div class="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent"></div>
              </div>
              <div class="p-3 space-y-1 flex-grow flex flex-col justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-violet-400">${entity}</span>
                <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-100 line-clamp-2">${name}</h4>
              </div>
            </a>
          `;
        });
        state.searchResults = state.searchResults.concat(cards);
        grid.innerHTML = state.searchResults.join('');
        updateSearchPagination();
      }
    } catch (e) {
      if (isStaleTab(token)) return;
      if (append && state.searchResults.length > 0) {
        // Keep already-rendered results; surface the failure as a toast.
        showToast(e.message || 'Failed to load more results.', 'error');
        return;
      }
      grid.innerHTML = '<div class="col-span-full py-16 text-center text-slate-400 text-sm">Failed to fetch search results.</div>';
      state.searchHasNext = false;
      updateSearchPagination();
    }
  }

  // Load More — fetch the next search page and append it to the results grid.
  document.getElementById('btn-search-load-more')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-search-load-more');
    if (!btn || btn.disabled) return;
    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Loading...');
    try {
      state.searchPage += 1;
      await loadSearchResults(true);
    } catch (e) {
      showToast(e.message || 'Failed to load more results.', 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  });


  // ==========================================
  // TAB 5: SOCIAL HUB (ACTIVITIES & PROFILES)
  // ==========================================
  function switchSocialTab(tabName) {
    const validTabs = ['feed', 'profile', 'messages'];
    const activeTab = validTabs.includes(tabName) ? tabName : 'feed';
    state.socialTab = activeTab;

    document.querySelectorAll('.social-tab-btn').forEach(btn => {
      const isActive = btn.dataset.socialTab === activeTab;
      btn.classList.toggle('active-social-tab', isActive);
      btn.classList.toggle('bg-violet-600', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('text-slate-400', !isActive);
      btn.classList.toggle('hover:text-white', !isActive);
    });

    document.querySelectorAll('[id^="social-content-"]').forEach(content => {
      content.classList.toggle('hidden', content.id !== `social-content-${activeTab}`);
    });

    // Keep the existing feed refresh behavior when returning to Activity Feed.
    if (activeTab === 'feed') loadActivityFeed();
  }

  document.querySelectorAll('.social-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSocialTab(btn.dataset.socialTab));
  });

  async function loadSocial() {
    switchSocialTab(state.socialTab);
  }

  async function loadActivityFeed() {
    const list = document.getElementById('activity-feed-list');
    if (!list) return;
    const token = tabToken;

    try {
      const query = `
        query {
          Page(page: 1, perPage: 10) {
            activities(sort: ID_DESC) {
              ... on TextActivity {
                id
                userId
                type
                text
                replyCount
                likeCount
                createdAt
                user {
                  name
                  avatar { medium }
                }
              }
              ... on ListActivity {
                id
                userId
                type
                status
                progress
                createdAt
                user {
                  name
                  avatar { medium }
                }
                media {
                  id
                  title { romaji english }
                  coverImage { medium }
                }
              }
            }
          }
        }
      `;
      const data = await queryAniList(query);
      if (isStaleTab(token)) return;
      const activities = data.Page.activities || [];

      if (activities.length === 0) {
        list.innerHTML = '<div class="py-8 text-center text-slate-400 text-xs">No recent activity posts.</div>';
        return;
      }

      list.innerHTML = activities.map(act => {
        if (!act.user) return '';
        const isText = act.type === 'TEXT' || act.text;
        return `
          <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <img src="${act.user.avatar.medium}" class="w-9 h-9 rounded-xl object-cover" />
                <div>
                  <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-200">${act.user.name}</h4>
                  <span class="text-[10px] text-slate-400">${new Date(act.createdAt * 1000).toLocaleTimeString()}</span>
                </div>
              </div>
              <button onclick="toggleLikeActivity(${act.id})" class="px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white font-bold text-[11px] transition-all flex items-center gap-1">
                <i class="fa-solid fa-heart"></i>${act.likeCount || 0}
              </button>
            </div>

            <p class="text-xs text-slate-700 dark:text-slate-300 font-medium">
              ${isText ? act.text : `${act.status} ${act.progress ? `ep ${act.progress} of` : ''} ${act.media ? formatTitle(act.media.title) : ''}`}
            </p>
          </div>
        `;
      }).join('');

    } catch (e) {
      if (isStaleTab(token)) return;
      list.innerHTML = '<div class="py-8 text-center text-slate-400 text-xs">Failed to load social activity feed.</div>';
    }
  }

  // Global like toggle — referenced from inline onclick in the activity feed.
  // Delegates to the backend so the server-side AniList token authorizes the
  // mutation (the browser never holds bearerTokenAnilist).
  window.toggleLikeActivity = async function(activityId) {
    try {
      const res = await fetch('/api/anilist/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activityId, type: 'ACTIVITY' })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to toggle like (HTTP ${res.status})`);
      }
      showToast('Like updated!');
      loadActivityFeed();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  document.getElementById('btn-post-activity')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-post-activity');
    if (btn.disabled) return;
    const input = document.getElementById('activity-input');
    if (!input || !input.value.trim()) return;
    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Posting...');
    try {
      const res = await fetch('/api/anilist/activity/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.value.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to post activity (HTTP ${res.status})`);
      input.value = '';
      showToast('Activity update posted successfully!');
      loadActivityFeed();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  });

  function renderProfileMessage(message, type = 'error') {
    const display = document.getElementById('user-profile-display');
    if (!display) return;
    display.classList.remove('hidden');
    const isLoading = type === 'loading';
    display.innerHTML = `
      <div class="py-8 text-center ${isLoading ? 'text-slate-400' : 'text-rose-500'}">
        <i class="fa-solid ${isLoading ? 'fa-spinner fa-spin text-violet-500' : 'fa-circle-exclamation'} text-xl mb-2"></i>
        <p class="text-xs font-semibold">${escapeHtml(message)}</p>
      </div>
    `;
  }

  function renderUserProfile(user, searchedName) {
    const display = document.getElementById('user-profile-display');
    if (!display) return;

    // The current backend returns AniList's `stats`/`favourites` fields under
    // `user`; accept the `statistics.anime` shape too for API compatibility.
    const stats = user.statistics?.anime || user.stats?.anime || user.stats || {};
    const favourites = user.favourites?.anime?.nodes
      || user.favourites?.anime
      || user.favorites?.anime?.nodes
      || [];
    const favouriteAnime = Array.isArray(favourites) ? favourites : [];
    const displayName = user.name || searchedName;
    const avatar = typeof user.avatar === 'string'
      ? user.avatar
      : user.avatar?.large || user.avatar?.medium || '';
    const safeAvatar = /^https?:\/\//i.test(avatar) ? escapeHtml(avatar) : '';
    const about = escapeHtml(user.about || 'No biography provided.').replace(/\r?\n/g, '<br>');
    const formatNumber = value => value === null || value === undefined || value === ''
      ? '—'
      : escapeHtml(Number(value).toLocaleString());

    const favouriteHtml = favouriteAnime.length
      ? favouriteAnime.slice(0, 6).map(favourite => `
          <li class="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
            ${escapeHtml(formatTitle(favourite?.title || favourite))}
          </li>
        `).join('')
      : '<li class="text-xs text-slate-400">No anime favourites listed.</li>';

    display.classList.remove('hidden');
    display.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-start gap-4">
        ${safeAvatar
          ? `<img src="${safeAvatar}" alt="${escapeHtml(displayName)} avatar" class="w-20 h-20 rounded-2xl object-cover border border-violet-500/30 shrink-0" />`
          : '<div class="w-20 h-20 rounded-2xl bg-violet-600/15 text-violet-500 flex items-center justify-center shrink-0"><i class="fa-solid fa-user text-2xl"></i></div>'}
        <div class="min-w-0 space-y-1">
          <h3 class="font-['Outfit'] font-bold text-xl text-slate-800 dark:text-slate-100">${escapeHtml(displayName)}</h3>
          <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">${about}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700">
          <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Anime Count</p>
          <p class="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">${formatNumber(stats.count)}</p>
        </div>
        <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700">
          <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Mean Score</p>
          <p class="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">${formatNumber(stats.meanScore)}%</p>
        </div>
        <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700">
          <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Minutes Watched</p>
          <p class="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">${formatNumber(stats.minutesWatched)}</p>
        </div>
        <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700">
          <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Episodes Watched</p>
          <p class="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">${formatNumber(stats.episodesWatched)}</p>
        </div>
      </div>

      <div class="space-y-2">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">Top Anime Favourites</h4>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">${favouriteHtml}</ul>
      </div>
    `;
  }

  async function searchUserProfile() {
    const input = document.getElementById('social-user-search');
    const btn = document.getElementById('btn-search-user-profile');
    const username = input?.value.trim() || '';
    if (!username) {
      renderProfileMessage('Enter an AniList username to search.');
      showToast('Enter an AniList username to search.', 'error');
      return;
    }

    renderProfileMessage('Looking up AniList profile…', 'loading');
    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Searching...');
    try {
      const res = await fetch(`/api/anilist/user/${encodeURIComponent(username)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = body.error || body.message || `Profile lookup failed (HTTP ${res.status})`;
        if (res.status === 404) {
          throw new Error(`AniList user "${username}" was not found.`);
        }
        throw new Error(detail);
      }

      const user = body.user || body.viewer || body;
      if (!user || !user.name) throw new Error('AniList returned an empty user profile.');
      renderUserProfile(user, username);
    } catch (e) {
      const message = e.message || 'Failed to load AniList user profile.';
      renderProfileMessage(message);
      showToast(message, 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  document.getElementById('btn-search-user-profile')?.addEventListener('click', searchUserProfile);
  document.getElementById('social-user-search')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') searchUserProfile();
  });


  // ==========================================
  // TAB 6: STATS (ANALYTICS & BREAKDOWNS)
  // ==========================================
  async function loadStats() {
    const genreContainer = document.getElementById('chart-genre-container');
    const formatContainer = document.getElementById('chart-format-container');
    const token = tabToken;

    const showError = (msg) => {
      console.error('Stats load error:', msg);
      const errHtml = `
        <div class="py-8 text-center">
          <i class="fa-solid fa-triangle-exclamation text-rose-500 text-xl mb-2"></i>
          <p class="text-xs font-semibold text-rose-500">Failed to load stats</p>
          <p class="text-[11px] text-slate-400 mt-1">${msg}</p>
        </div>`;
      if (genreContainer) genreContainer.innerHTML = errHtml;
      if (formatContainer) formatContainer.innerHTML = errHtml;
      showToast(`Stats failed to load: ${msg}`, 'error');
    };

    const showEmpty = () => {
      const emptyHtml = `
        <div class="py-8 text-center">
          <i class="fa-solid fa-inbox text-slate-400 text-xl mb-2"></i>
          <p class="text-xs font-semibold text-slate-400">No collection data yet.</p>
          <p class="text-[11px] text-slate-500 mt-1">Add entries to your AniList collection to see stats here.</p>
        </div>`;
      if (genreContainer) genreContainer.innerHTML = emptyHtml;
      if (formatContainer) formatContainer.innerHTML = emptyHtml;
    };

    try {
      // Fetch the full private collection through the backend so the
      // server-side AniList token is used — the browser has no token
      // (stripped by /api/config), so a direct query returns empty lists.
      const params = new URLSearchParams({
        userName: state.userName || '',
        type: 'ANIME',
      });
      const res = await fetch(`/api/anilist/user-list?${params.toString()}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Failed to load collection (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (isStaleTab(token)) return;
      const collections = data.lists || [];

      // Flatten all list-group entries into one array
      const entries = [];
      collections.forEach(l => {
        (l.entries || []).forEach(e => entries.push(e));
      });

      if (entries.length === 0) {
        document.getElementById('stat-total-anime').textContent = 0;
        document.getElementById('stat-days-watched').textContent = '0.0';
        document.getElementById('stat-mean-score').textContent = '0.0';
        document.getElementById('stat-total-episodes').textContent = 0;
        showEmpty();
        return;
      }

      // ---- Overview numbers ----
      const totalAnime = entries.length;
      // Approximate minutes watched from per-episode duration (fallback 24 min)
      const minutesWatched = entries.reduce((acc, e) => {
        const eps = e.progress || 0;
        const dur = e.media?.duration || 24;
        return acc + (eps * dur);
      }, 0);
      const daysWatched = (minutesWatched / 1440).toFixed(1);
      const totalEpisodes = entries.reduce((acc, e) => acc + (e.progress || 0), 0);

      // Mean score — average of scored entries only (POINT_100, 0 = unscored)
      const scored = entries.filter(e => e.score && e.score > 0).map(e => e.score);
      const meanScore = scored.length
        ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1)
        : '0.0';

      document.getElementById('stat-total-anime').textContent = totalAnime;
      document.getElementById('stat-days-watched').textContent = daysWatched;
      document.getElementById('stat-mean-score').textContent = meanScore;
      document.getElementById('stat-total-episodes').textContent = totalEpisodes;

      // ---- Genre Distribution ----
      const genreCounts = {};
      entries.forEach(e => {
        (e.media?.genres || []).forEach(g => {
          genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
      });

      const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const maxGenre = sortedGenres[0]?.[1] || 1;

      if (genreContainer) {
        if (sortedGenres.length === 0) {
          genreContainer.innerHTML = '<div class="text-slate-400 text-xs py-4 text-center">No genre data available.</div>';
        } else {
          genreContainer.innerHTML = sortedGenres.map(([g, count]) => {
            const pct = Math.round((count / maxGenre) * 100);
            return `
              <div class="space-y-1">
                <div class="flex justify-between text-xs font-semibold">
                  <span>${g}</span>
                  <span class="text-slate-400">${count} anime (${pct}%)</span>
                </div>
                <div class="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div class="h-full bg-gradient-to-r from-violet-600 to-pink-500 rounded-full" style="width: ${pct}%"></div>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // ---- Format & Tag Breakdown ----
      const formatCounts = {};
      entries.forEach(e => {
        const fmt = e.media?.format || 'UNKNOWN';
        formatCounts[fmt] = (formatCounts[fmt] || 0) + 1;
      });
      const sortedFormats = Object.entries(formatCounts).sort((a, b) => b[1] - a[1]);
      const maxFormat = sortedFormats[0]?.[1] || 1;

      const fmtLabel = fmt => fmt.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

      let formatHtml = '';
      if (sortedFormats.length === 0) {
        formatHtml = '<div class="text-slate-400 text-xs py-4 text-center">No format data available.</div>';
      } else {
        formatHtml = sortedFormats.map(([fmt, count]) => {
          const pct = Math.round((count / maxFormat) * 100);
          return `
            <div class="space-y-1">
              <div class="flex justify-between text-xs font-semibold">
                <span>${fmtLabel(fmt)}</span>
                <span class="text-slate-400">${count} (${pct}%)</span>
              </div>
              <div class="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div class="h-full bg-gradient-to-r from-pink-500 to-amber-400 rounded-full" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
        }).join('');
      }

      // Top tags (if present in the collection payload)
      const tagCounts = {};
      entries.forEach(e => {
        (e.media?.tags || []).forEach(t => {
          const name = typeof t === 'string' ? t : t?.name;
          if (name) tagCounts[name] = (tagCounts[name] || 0) + 1;
        });
      });
      const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      if (formatContainer) {
        formatContainer.innerHTML = formatHtml + (topTags.length
          ? `
            <div class="pt-3 mt-3 border-t border-slate-200/60 dark:border-slate-800">
              <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Top Tags</p>
              <div class="flex flex-wrap gap-1.5">
                ${topTags.map(([t, count]) =>
                  `<span class="px-2 py-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-300">${t} · ${count}</span>`
                ).join('')}
              </div>
            </div>`
          : '');
      }

    } catch (e) {
      if (isStaleTab(token)) return;
      showError(e.message || 'Unknown error');
    }
  }


  // ==========================================
  // TAB 7 & 8: HISTORY & LOGS
  // ==========================================
  async function loadHistory() {
    const token = tabToken;
    try {
      const res = await API.getHistory();
      if (isStaleTab(token)) return;
      state.history = res.history || [];
      renderHistoryList(state.history);
    } catch (e) {
      if (isStaleTab(token)) return;
      showToast(e.message, 'error');
    }
  }

  // History search box — filters the loaded history list client-side.
  DOM.historySearchInput?.addEventListener('input', () => {
    const q = (DOM.historySearchInput.value || '').toLowerCase().trim();
    if (!q) {
      renderHistoryList(state.history);
      return;
    }
    const filtered = (state.history || []).filter(item =>
      (item.title || '').toLowerCase().includes(q)
    );
    renderHistoryList(filtered);
  });

  DOM.historyRefreshBtn?.addEventListener('click', () => loadHistory());

  function renderHistoryList(items) {
    if (!DOM.historyList) return;
    if (items.length === 0) {
      DOM.historyList.innerHTML = '<div class="py-12 text-center text-slate-400 text-sm">No download history available.</div>';
      return;
    }

    DOM.historyList.innerHTML = items.map(item => {
      // Bare-title entries (no torrent name) get a fallback label so the
      // history list never shows an empty/undefined title.
      const title = item.title || item.anime_title || 'Untitled download';
      const subtitle = item.episode != null && item.episode !== '' ? `Ep ${item.episode}` : null;
      return `
      <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          ${item.cover_image ? `<img src="${item.cover_image}" class="w-10 h-12 object-cover rounded-xl" />` : '<i class="fa-solid fa-download text-violet-500 text-lg"></i>'}
          <div class="min-w-0">
            <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-200 truncate">${title}${subtitle ? ` <span class="text-violet-400">· ${subtitle}</span>` : ''}</h4>
            <span class="text-[10px] text-slate-400">${item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Just now'}</span>
          </div>
        </div>
        <button onclick="deleteHistoryEntry('${item.id}')" class="text-rose-500 hover:text-rose-600 p-2 shrink-0"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    }).join('');
  }

  window.deleteHistoryEntry = async function(id) {
    try {
      await API.deleteHistoryItem(id);
      showToast('History item deleted.');
      loadHistory();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  DOM.historyClearBtn?.addEventListener('click', async () => {
    try {
      await API.clearHistory();
      showToast('Download history cleared.');
      loadHistory();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  async function loadLogs() {
    if (!DOM.logsBody || !DOM.logSelect || !DOM.logLines) return;
    const token = tabToken;
    try {
      const res = await API.getLogs(DOM.logSelect.value, DOM.logLines.value);
      if (isStaleTab(token)) return;
      DOM.logsBody.textContent = res.content || 'Console log is empty.';
    } catch (e) {
      if (isStaleTab(token)) return;
      DOM.logsBody.textContent = `Failed to load console log: ${e.message}`;
    }
  }

  DOM.logRefreshBtn?.addEventListener('click', () => loadLogs());

  // Auto-refresh checkbox — polls the log tail while the logs tab is visible.
  let logAutoRefreshTimer = null;
  DOM.logAutoRefresh?.addEventListener('change', () => {
    if (DOM.logAutoRefresh.checked) {
      if (!logAutoRefreshTimer) {
        logAutoRefreshTimer = setInterval(() => {
          if (state.activeTab === 'logs') loadLogs();
        }, 3000);
      }
      loadLogs();
    } else if (logAutoRefreshTimer) {
      clearInterval(logAutoRefreshTimer);
      logAutoRefreshTimer = null;
    }
  });

  // ---- Search Diagnostics (failed-run traces) ----
  function renderSearchDebug(traces) {
    const container = DOM.searchDebugContainer;
    if (!container) return;
    if (!traces || traces.length === 0) {
      container.innerHTML = '<div class="p-5 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/30 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">No failed runs logged in the current check cycle.</div>';
      return;
    }
    container.innerHTML = traces.map(t => `
      <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-rose-500/20 space-y-2">
        <div class="flex items-center justify-between gap-3">
          <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-200 line-clamp-1">${t.anime_title || `Anime-${t.media_id}`}</h4>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-500 text-[10px] font-bold uppercase shrink-0">${t.status || 'NO_RESULTS'}</span>
        </div>
        <p class="text-[11px] text-slate-400 font-mono break-all">Query: ${t.search_query || '-'}</p>
        ${t.candidates && t.candidates.length ? `
          <div class="space-y-1.5">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Top candidates</p>
            ${t.candidates.map(c => `
              <div class="flex items-center justify-between gap-3 text-[11px]">
                <span class="text-slate-500 dark:text-slate-400 line-clamp-1 flex-grow">${c.title || 'Untitled torrent'}</span>
                <span class="font-bold ${(c.rating || 0) >= 60 ? 'text-emerald-400' : 'text-amber-400'} shrink-0">${Math.round(c.rating || 0)}%</span>
              </div>
            `).join('')}
          </div>
        ` : '<p class="text-[11px] text-slate-500 italic">No candidates matched this cycle.</p>'}
        ${t.last_attempt ? `<p class="text-[10px] text-slate-400">Last attempt: ${new Date(t.last_attempt * 1000).toLocaleString()}</p>` : ''}
      </div>
    `).join('');
  }

  async function loadSearchDebug() {
    if (!DOM.searchDebugContainer) return;
    const token = tabToken;
    const btn = DOM.btnRefreshSearchDebug;
    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i>');
    try {
      const traces = await API.getSearchDebug();
      if (isStaleTab(token)) return;
      renderSearchDebug(traces);
    } catch (e) {
      if (isStaleTab(token)) return;
      if (DOM.searchDebugContainer) {
        DOM.searchDebugContainer.innerHTML = `<div class="p-5 text-center text-xs text-rose-500 bg-slate-50 dark:bg-slate-900/30 border border-rose-500/20 rounded-2xl">Failed to load diagnostics: ${e.message}</div>`;
      }
    } finally {
      setBtnLoading(btn, false);
    }
  }

  DOM.btnRefreshSearchDebug?.addEventListener('click', loadSearchDebug);


  // ==========================================
  // TAB 9: SETTINGS & CONFIGURATION
  // ==========================================
  async function loadSettings() {
    try {
      const cfg = await API.getConfig();
      state.config = cfg;
      populateConfigForm(cfg);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function populateConfigForm(cfg) {
    if (!DOM.configForm) return;
    Object.keys(cfg).forEach(key => {
      const input = DOM.configForm.querySelector(`[name="${key}"]`);
      if (input) {
        if (input.type === 'checkbox') input.checked = Boolean(cfg[key]);
        else if (Array.isArray(cfg[key])) input.value = cfg[key].join(', ');
        else if (typeof cfg[key] === 'object' && cfg[key] !== null) {
          input.value = Object.entries(cfg[key]).map(([k, v]) => `${k}=${v}`).join(', ');
        }
        else input.value = cfg[key] ?? '';
      }
    });
  }

  DOM.btnSubmitConfig?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (DOM.btnSubmitConfig.disabled) return;
    const formData = new FormData(DOM.configForm);
    const payload = {};
    formData.forEach((val, key) => {
      const input = DOM.configForm.querySelector(`[name="${key}"]`);
      // excludeReleaseGroups is stored server-side as a List[str] — send the
      // CSV input as a trimmed array instead of a raw string.
      if (key === 'excludeReleaseGroups') {
        payload[key] = String(val).split(',').map(s => s.trim()).filter(Boolean);
      }
      else if (key === 'releaseGroupTierOverrides') {
        const overrides = {};
        String(val).split(',').forEach(item => {
          const parts = item.split('=');
          if (parts.length === 2 && parts[0].trim()) {
            overrides[parts[0].trim()] = parts[1].trim();
          }
        });
        payload[key] = overrides;
      }
      else if (input && input.type === 'checkbox') payload[key] = input.checked;
      else if (input && input.type === 'number') payload[key] = Number(val);
      else payload[key] = val;
    });

    DOM.configForm.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.name) payload[cb.name] = cb.checked;
    });

    setBtnLoading(DOM.btnSubmitConfig, true, '<i class="fa-solid fa-spinner fa-spin"></i> Hotloading...');
    try {
      await API.saveConfig(payload);
      showToast('Configuration hotloaded successfully!');
      loadSettings();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBtnLoading(DOM.btnSubmitConfig, false);
    }
  });

  // ---- Live OAuth status box ----
  // Reflects the real auth state from /api/anilist/auth/state instead of a
  // hardcoded "Active Token / Expires: Never" box.

  async function loadAuthState() {
    const d = {
      indicator: document.getElementById('auth-status-indicator'),
      statusText: document.getElementById('auth-status-text'),
      expiryText: document.getElementById('token-expiry-text'),
      warning: document.getElementById('token-expiry-warning'),
      ok: document.getElementById('token-expiry-ok'),
      btn: document.getElementById('btn-anilist-oauth'),
    };
    if (!d.statusText) return; // Settings panel not in DOM

    try {
      const res = await fetch('/api/anilist/auth/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const state = await res.json();
      const connected = Boolean(state.authenticated);
      const needsReauth = Boolean(state.needsReauth);
      const expiry = state.tokenExpiry || {};

      if (!connected) {
        if (d.indicator) d.indicator.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shrink-0';
        if (d.statusText) d.statusText.textContent = 'OAuth Status: Not connected';
        if (d.expiryText) d.expiryText.textContent = '';
        if (d.warning) d.warning.classList.add('hidden');
        if (d.ok) d.ok.classList.add('hidden');
        if (d.btn) d.btn.innerHTML = '<i class="fa-solid fa-right-to-bracket text-[10px]"></i>Connect';
        return;
      }

      if (d.indicator) d.indicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shrink-0';
      if (d.statusText) d.statusText.textContent = `OAuth Status: Connected${state.userName ? ` as ${state.userName}` : ''}`;
      if (d.btn) d.btn.innerHTML = '<i class="fa-solid fa-right-to-bracket text-[10px]"></i>Reconnect';

      if (needsReauth) {
        if (d.expiryText) d.expiryText.textContent = 'Expired';
        if (d.warning) {
          d.warning.classList.remove('hidden');
          const warnText = document.getElementById('token-expiry-text-warning');
          if (warnText) warnText.textContent = 'Token expired — re-authentication required.';
        }
        if (d.ok) d.ok.classList.add('hidden');
      } else if (expiry.daysRemaining !== undefined && expiry.daysRemaining >= 0 && expiry.daysRemaining <= 30) {
        if (d.expiryText) d.expiryText.textContent = `Expires in ${expiry.daysRemaining} day(s)`;
        if (d.warning) {
          d.warning.classList.remove('hidden');
          const warnText = document.getElementById('token-expiry-text-warning');
          if (warnText) warnText.textContent = `Token expires in ${expiry.daysRemaining} day(s). Re-authenticate soon.`;
        }
        if (d.ok) d.ok.classList.add('hidden');
      } else {
        if (d.expiryText) d.expiryText.textContent =
          expiry.daysRemaining !== undefined && expiry.daysRemaining >= 0
            ? `Expires in ${expiry.daysRemaining} days`
            : 'Expiry: persistent token';
        if (d.warning) d.warning.classList.add('hidden');
        if (d.ok) d.ok.classList.remove('hidden');
      }
    } catch (err) {
      if (d.indicator) d.indicator.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shrink-0';
      if (d.statusText) d.statusText.textContent = 'OAuth Status: Unable to check';
      if (d.expiryText) d.expiryText.textContent = '';
      if (d.warning) d.warning.classList.add('hidden');
      if (d.ok) d.ok.classList.add('hidden');
    }
  }

  document.getElementById('btn-anilist-oauth')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/anilist/auth/url?grant=token');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.error || body.message || `HTTP ${res.status}`;
        const setupHint = /client id.*not configured/i.test(detail)
          ? ' — add anilistClientId to profile.json'
          : '';
        throw new Error(`OAuth setup incomplete: ${detail}${setupHint}`);
      }
      const data = await res.json();
      const url = data.authUrl || data.url;
      if (!url) throw new Error('No auth URL returned.');
      const popup = window.open(url, 'anilist-oauth', 'width=600,height=700,scrollbars=yes,resizable=yes');
      if (!popup) {
        showToast('Popup blocked — opening auth in a new tab.', 'warning');
        window.open(url, '_blank');
        return;
      }
      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.data && event.data.type === 'anilist-auth-complete') {
          window.removeEventListener('message', onMessage);
          showToast(event.data.ok ? 'AniList authentication successful!' : `Auth failed: ${event.data.error || 'Unknown error'}`, event.data.ok ? 'success' : 'error');
          loadAuthState();
        }
      }
      window.addEventListener('message', onMessage);
      const checker = setInterval(() => {
        if (popup.closed) {
          clearInterval(checker);
          window.removeEventListener('message', onMessage);
          loadAuthState();
        }
      }, 1000);
    } catch (err) {
      const message = err.message || 'Could not generate AniList auth URL.';
      showToast(message.startsWith('OAuth setup incomplete:') ? message : `Auth error: ${message}`, 'error');
    }
  });

  // Reveal-on-demand toggle for the masked Discord webhook field.
  document.getElementById('btn-toggle-webhook')?.addEventListener('click', () => {
    const input = document.getElementById('webhook-input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const icon = document.querySelector('#btn-toggle-webhook i');
    if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });


  function listStatusLabel(status) {
    if (!status) return '';
    const map = {
      CURRENT: 'Watching',
      REPEATING: 'Re-watching',
      COMPLETED: 'Completed',
      PAUSED: 'Paused',
      DROPPED: 'Dropped',
      PLANNING: 'Planning'
    };
    if (map[status]) return map[status];
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }

  // ==========================================
  // FULL-SCREEN MEDIA DETAIL MODAL RENDERER
  // ==========================================
  window.openMediaDetail = async function(mediaId) {
    openModal(DOM.mediaDetailModal);
    const content = DOM.mediaDetailContent;
    if (!content) return;

    content.innerHTML = '<div class="py-24 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-violet-500"></i><p>Loading title details...</p></div>';

    try {
      const query = `
        query ($id: Int) {
          Media(id: $id) {
            id
            title { romaji english native }
            coverImage { extraLarge large }
            bannerImage
            description
            format
            status
            episodes
            duration
            season
            seasonYear
            averageScore
            popularity
            genres
            tags { name rank isMediaSpoiler }
            siteUrl
            trailer { id site thumbnail }
            relations {
              edges {
                relationType
                node {
                  id
                  title { romaji english }
                  coverImage { medium }
                }
              }
            }
            characters(perPage: 6) {
              edges {
                role
                node {
                  name { full }
                  image { medium }
                }
                voiceActors(language: JAPANESE) {
                  name { full }
                  image { medium }
                }
              }
            }
            reviews(perPage: 2) {
              nodes {
                summary
                score
                user { name }
              }
            }
            stats {
              scoreDistribution { score amount }
              statusDistribution { status amount }
            }
          }
        }
      `;
      const data = await queryAniList(query, { id: mediaId });
      const m = data.Media;
      state.activeMediaDetail = m;
      await ensureListEntriesLoaded();

      const title = formatTitle(m.title);
      const isDownloaded = state.animeList.some(a => a.mediaId === m.id);
      const listEntry = state.listEntriesByMedia[m.id] || null;

      // Score distribution SVG histogram generator
      const scoreDist = m.stats?.scoreDistribution || [];
      const maxAmount = Math.max(...scoreDist.map(s => s.amount), 1);
      const svgHistogram = scoreDist.map(s => {
        const height = Math.round((s.amount / maxAmount) * 60);
        return `<rect x="${(s.score / 10) * 80}" y="${60 - height}" width="6" height="${height}" fill="#8b5cf6" rx="2" />`;
      }).join('');

      content.innerHTML = `
        <div class="relative w-full">
          <!-- Hero Banner -->
          <div class="h-56 sm:h-72 w-full relative overflow-hidden bg-slate-900">
            ${m.bannerImage ? `<img src="${m.bannerImage}" class="w-full h-full object-cover opacity-60" />` : ''}
            <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/40 to-transparent"></div>
          </div>

          <div class="px-6 sm:px-10 -mt-24 relative z-10 space-y-8 pb-10">
            <!-- Header Block -->
            <div class="flex flex-col sm:flex-row gap-6 items-start">
              <img src="${m.coverImage.extraLarge || m.coverImage.large}" class="w-36 sm:w-44 rounded-2xl shadow-2xl border-2 border-slate-800 object-cover shrink-0" />
              <div class="space-y-3 flex-grow pt-4 sm:pt-12">
                <div class="flex flex-wrap gap-2 items-center">
                  <span class="px-2.5 py-1 rounded-xl bg-violet-600/20 text-violet-400 text-xs font-bold uppercase">${m.format || 'TV'}</span>
                  <span class="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 text-xs font-bold">${m.status}</span>
                  ${isDownloaded ? '<span class="px-2.5 py-1 rounded-xl bg-emerald-600 text-white text-xs font-bold"><i class="fa-solid fa-check mr-1"></i>In Watching List</span>' : ''}
                  ${listEntry ? `<span class="px-2.5 py-1 rounded-xl bg-violet-600/20 text-violet-300 text-xs font-bold"><i class="fa-solid fa-bookmark mr-1"></i>In Your List · ${listStatusLabel(listEntry.status)}${(listEntry.progress > 0 || m.episodes) ? ` · Ep ${listEntry.progress || 0}/${m.episodes || '?'}` : ''}</span>` : ''}
                </div>
                <h2 class="text-2xl sm:text-3xl font-extrabold font-['Outfit'] text-slate-900 dark:text-white leading-tight">${title}</h2>
                <div class="flex items-center gap-4 text-xs font-bold text-slate-400">
                  <span class="text-amber-400"><i class="fa-solid fa-star mr-1"></i>${m.averageScore ? `${m.averageScore}%` : 'N/A'}</span>
                  <span>${m.episodes ? `${m.episodes} episodes` : '? eps'} (${m.duration || 24}m)</span>
                  <span>${m.season || ''} ${m.seasonYear || ''}</span>
                </div>

                <!-- Action Toolbar -->
                <div class="flex flex-wrap gap-3 pt-3">
                  <button onclick="openListEditor(${m.id})" class="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-lg shadow-violet-500/20 text-xs cursor-pointer">
                    <i class="fa-solid ${listEntry ? 'fa-pen' : 'fa-plus'} mr-1"></i>${listEntry ? 'Edit List Entry' : 'Add to List'}
                  </button>
                  <button onclick="openNyaaDialog(${m.id})" class="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs cursor-pointer">
                    Search Nyaa Torrents
                  </button>
                </div>
              </div>
            </div>

            <!-- Synopsis & Spoiler Toggle -->
            <div class="p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800 space-y-3">
              <h3 class="font-['Outfit'] font-bold text-base text-slate-900 dark:text-white">Synopsis</h3>
              <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${m.description || 'No detailed synopsis available.'}</p>
            </div>

            <!-- Inline SVG Score Distribution Chart -->
            <div class="p-6 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800 space-y-4">
              <h3 class="font-['Outfit'] font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <i class="fa-solid fa-chart-column text-violet-500"></i>Score Distribution Histogram
              </h3>
              <div class="w-full h-24 flex items-end justify-center">
                <svg viewBox="0 0 100 60" class="w-full h-full">
                  ${svgHistogram}
                </svg>
              </div>
            </div>

            <!-- Typed Relations Cards -->
            ${m.relations?.edges?.length ? `
              <div class="space-y-3">
                <h3 class="font-['Outfit'] font-bold text-base">Typed Relations</h3>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  ${m.relations.edges.map(e => `
                    <div onclick="openMediaDetail(${e.node.id})" class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-800 flex items-center gap-2.5 cursor-pointer hover:border-violet-500 transition-all">
                      <img src="${e.node.coverImage.medium}" class="w-8 h-10 object-cover rounded-md shrink-0" />
                      <div>
                        <span class="text-[9px] font-bold text-violet-400 uppercase">${e.relationType}</span>
                        <p class="font-bold text-[11px] line-clamp-1">${formatTitle(e.node.title)}</p>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Characters & Voice Actors Grid -->
            ${m.characters?.edges?.length ? `
              <div class="space-y-3">
                <h3 class="font-['Outfit'] font-bold text-base">Key Characters & Voice Actors</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  ${m.characters.edges.map(c => `
                    <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div class="flex items-center gap-2.5">
                        <img src="${c.node.image.medium}" class="w-9 h-9 rounded-xl object-cover" />
                        <div>
                          <p class="font-bold text-xs">${c.node.name.full}</p>
                          <span class="text-[10px] text-slate-400">${c.role}</span>
                        </div>
                      </div>
                      ${c.voiceActors?.[0] ? `
                        <div class="text-right">
                          <p class="font-bold text-[11px] text-violet-400">${c.voiceActors[0].name.full}</p>
                          <span class="text-[9px] text-slate-500">Japanese</span>
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

          </div>
        </div>
      `;

    } catch (e) {
      content.innerHTML = `<div class="py-16 text-center text-rose-500 text-sm font-bold">Failed to load media details: ${e.message}</div>`;
    }
  };


  // ==========================================
  // LIST EDITOR MODAL & 5 SCORE FORMATS
  // ==========================================
  // The editor is keyed by mediaId; the backend list-entry id (needed for
  // DeleteMediaListEntry) is resolved from the loaded collection or fetched.
  let activeListEditorEntryId = null;

  window.openListEditor = async function(mediaId, entryId) {
    await ensureListEntriesLoaded();
    state.activeListEditorMedia = mediaId;
    // Prefer the caller-provided entry id; fall back to the loaded collection.
    const entry = state.listEntriesByMedia ? state.listEntriesByMedia[mediaId] : null;
    activeListEditorEntryId = entryId || (entry ? entry.id : null);
    document.getElementById('editor-media-id').value = mediaId;
    // Prefill known fields so the editor is never a blank guess.
    document.getElementById('editor-status').value = entry?.status || 'CURRENT';
    document.getElementById('editor-progress').value = entry?.progress || 0;
    // Collection scores are POINT_100; default the selector to match.
    document.getElementById('editor-score-format').value = 'POINT_100';
    document.getElementById('editor-score').value = entry?.score || 0;
    document.getElementById('editor-notes').value = entry?.notes || '';
    document.getElementById('editor-repeat').value = entry?.repeat || 0;
    if (entry?.startedAt) {
      const d = entry.startedAt;
      document.getElementById('editor-start-date').value = d.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '';
    }
    if (entry?.completedAt) {
      const d = entry.completedAt;
      document.getElementById('editor-finish-date').value = d.year ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '';
    }

    const btnDelete = document.getElementById('btn-editor-delete');
    if (btnDelete) {
      btnDelete.style.display = entry ? '' : 'none';
    }
    const titleEl = document.getElementById('list-editor-title');
    if (titleEl) {
      titleEl.textContent = entry ? 'Edit List Entry' : 'Add to List';
    }

    openModal(DOM.listEditorModal);
  };

  // Progress +/- steppers next to the episode input (min 0).
  document.getElementById('btn-progress-dec')?.addEventListener('click', () => {
    const input = document.getElementById('editor-progress');
    input.value = Math.max(0, (parseInt(input.value) || 0) - 1);
  });
  document.getElementById('btn-progress-inc')?.addEventListener('click', () => {
    const input = document.getElementById('editor-progress');
    input.value = (parseInt(input.value) || 0) + 1;
  });

  // Adjust the score input's range/step when the format selector changes.
  document.getElementById('editor-score-format')?.addEventListener('change', () => {
    const format = document.getElementById('editor-score-format').value;
    const input = document.getElementById('editor-score');
    const ranges = {
      POINT_100: { max: 100, step: 1, placeholder: '0' },
      POINT_10_DECIMAL: { max: 10, step: 0.1, placeholder: '0.0' },
      POINT_10: { max: 10, step: 1, placeholder: '0' },
      POINT_5: { max: 5, step: 1, placeholder: '0' },
      POINT_3: { max: 3, step: 1, placeholder: '0' }
    };
    const r = ranges[format] || ranges.POINT_100;
    input.max = r.max;
    input.step = r.step;
    input.placeholder = r.placeholder;
  });

  // Converts a user-entered score (in the selected display format) to the
  // 0-100 raw score AniList stores internally.
  function scoreToRaw(format, value) {
    const v = parseFloat(value);
    if (isNaN(v)) return null;
    switch (format) {
      case 'POINT_10_DECIMAL':
      case 'POINT_10':
        return Math.round(v * 10);
      case 'POINT_5':
        return Math.round(v * 20);
      case 'POINT_3':
        return Math.round(v * 33.33);
      case 'POINT_100':
      default:
        return Math.round(v);
    }
  }

  // Shared: POST /api/anilist/list/update with the server-side AniList token.
  // The browser never holds the bearer token (stripped by /api/config), so all
  // mutations must go through the backend rather than the direct GraphQL call.
  async function saveListEntryViaBackend(payload) {
    const res = await fetch('/api/anilist/list/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to save list entry (HTTP ${res.status})`);
    return body;
  }

  document.getElementById('btn-editor-save')?.addEventListener('click', async (e) => {
    const btn = document.getElementById('btn-editor-save');
    if (btn.disabled) return;
    const mediaId = parseInt(document.getElementById('editor-media-id').value);
    const status = document.getElementById('editor-status').value;
    const progress = parseInt(document.getElementById('editor-progress').value) || 0;
    const format = document.getElementById('editor-score-format').value;
    const raw = scoreToRaw(format, document.getElementById('editor-score').value);
    const notes = document.getElementById('editor-notes')?.value || '';
    const repeat = parseInt(document.getElementById('editor-repeat')?.value) || 0;

    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Saving...');
    try {
      const payload = { mediaId, status, progress, notes, repeat };
      if (raw !== null) payload.scoreRaw = raw;
      if (activeListEditorEntryId) payload.id = activeListEditorEntryId;
      const body = await saveListEntryViaBackend(payload);
      showToast('List entry saved successfully!');

      const savedId = (body && (body.id || body.SaveMediaListEntry?.id)) || activeListEditorEntryId || (state.listEntriesByMedia[mediaId] && state.listEntriesByMedia[mediaId].id) || null;
      state.listEntriesByMedia[mediaId] = {
        ...(state.listEntriesByMedia[mediaId] || {}),
        id: savedId, mediaId, status, progress, notes, repeat,
        score: raw !== null ? raw : (state.listEntriesByMedia[mediaId] ? state.listEntriesByMedia[mediaId].score : 0),
        updatedAt: Math.floor(Date.now() / 1000)
      };

      closeModal(DOM.listEditorModal);
      if (state.activeTab === 'lists') loadUserListsData();
      if (state.activeMediaDetail && state.activeMediaDetail.id === mediaId) {
        openMediaDetail(mediaId);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  });

  // Resolve the AniList list-entry id for a media id via the backend collection
  // (mirrors the Lists tab load path) — needed for DeleteMediaListEntry.
  async function resolveListEntryId(mediaId) {
    const res = await fetch(`/api/anilist/user-list?userName=${encodeURIComponent(state.userName || '')}&type=ANIME&perChunk=500`);
    if (!res.ok) return null;
    const data = await res.json();
    for (const l of data.lists || []) {
      const hit = (l.entries || []).find(en => en.mediaId === mediaId);
      if (hit) return hit.id;
    }
    return null;
  }

  document.getElementById('btn-editor-delete')?.addEventListener('click', async (e) => {
    const btn = document.getElementById('btn-editor-delete');
    if (btn.disabled) return;
    const mediaId = parseInt(document.getElementById('editor-media-id').value);
    setBtnLoading(btn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Removing...');
    try {
      let entryId = activeListEditorEntryId;
      if (!entryId) entryId = await resolveListEntryId(mediaId);
      if (!entryId) throw new Error('No AniList entry found for this media — nothing to remove.');
      const res = await fetch(`/api/anilist/list/${entryId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to remove list entry (HTTP ${res.status})`);
      showToast('List entry removed from AniList.');
      delete state.listEntriesByMedia[mediaId];
      closeModal(DOM.listEditorModal);
      if (state.activeTab === 'lists') loadUserListsData();
      if (state.activeMediaDetail && state.activeMediaDetail.id === mediaId) {
        openMediaDetail(mediaId);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  });


  // ==========================================
  // OVERLAY DIALOG 1: ANIME OVERRIDES
  // ==========================================
  window.openAnimeSettings = function(mediaId) {
    const anime = state.animeList.find(x => x.mediaId === mediaId);
    if (!anime) return;

    DOM.editMediaId.value = mediaId;
    DOM.editAltTitle.value = anime.media.alternativeTitle || '';
    DOM.editStartEp.value = anime.media.startingEpisode || 0;

    openModal(DOM.settingsDialog);
  };

  DOM.btnSaveSettings.addEventListener('click', async (e) => {
    e.preventDefault();
    if (DOM.btnSaveSettings.disabled) return;
    const mediaId = DOM.editMediaId.value;
    const alternativeTitle = DOM.editAltTitle.value;
    const startingEpisode = DOM.editStartEp.value;

    setBtnLoading(DOM.btnSaveSettings, true, '<i class="fa-solid fa-spinner fa-spin"></i> Saving...');
    try {
      await API.saveAnime(mediaId, { alternativeTitle, startingEpisode });
      showToast('Anime overrides saved successfully.');
      closeModal(DOM.settingsDialog);
      loadWatching();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBtnLoading(DOM.btnSaveSettings, false);
    }
  });

  DOM.btnResetDownloads.addEventListener('click', async (e) => {
    e.preventDefault();
    if (DOM.btnResetDownloads.disabled) return;
    const mediaId = DOM.editMediaId.value;
    setBtnLoading(DOM.btnResetDownloads, true, '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...');
    try {
      await API.resetAnime(mediaId);
      showToast('Downloaded episode cache reset.');
      closeModal(DOM.settingsDialog);
      loadWatching();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBtnLoading(DOM.btnResetDownloads, false);
    }
  });


  // ==========================================
  // OVERLAY DIALOG 2: NYAA EPISODE SEARCH
  // ==========================================
  window.openNyaaDialog = async function(mediaId) {
    const anime = state.animeList.find(x => x.mediaId === mediaId);
    openModal(DOM.nyaaDialog);
    DOM.nyaaList.innerHTML = '<div class="py-12 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-violet-500"></i><p>Querying Nyaa.si index...</p></div>';

    try {
      const data = await API.searchNyaa(mediaId);
      if (!data.results || data.results.length === 0) {
        DOM.nyaaList.innerHTML = '<div class="py-12 text-center text-slate-400 text-sm">No torrent candidates found.</div>';
        return;
      }

      DOM.nyaaList.innerHTML = data.results.map(c => `
        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-4 text-xs">
          <div class="space-y-1">
            <h4 class="font-['Outfit'] font-bold text-slate-800 dark:text-slate-200 line-clamp-1">${c.title}</h4>
            <div class="flex items-center gap-3 text-slate-400 font-semibold">
              <span class="text-emerald-400"><i class="fa-solid fa-seedling mr-1"></i>${c.seeders} seeders</span>
              <span>${c.size}</span>
              <span>${c.pubDate}</span>
            </div>
          </div>
          <button onclick="downloadTorrent('${mediaId}', '${encodeURIComponent(c.link)}')" class="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold shrink-0 transition-all">
            Download
          </button>
        </div>
      `).join('');

    } catch (e) {
      DOM.nyaaList.innerHTML = `<div class="py-12 text-center text-rose-500 text-sm font-bold">Search error: ${e.message}</div>`;
    }
  };

  window.downloadTorrent = async function(mediaId, encodedLink) {
    try {
      const link = decodeURIComponent(encodedLink);
      await API.downloadNyaa(mediaId, link);
      showToast('Torrent added to qBittorrent!');
      closeModal(DOM.nyaaDialog);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };


  // ==========================================
  // INITIALIZATION
  // ==========================================
  initTheme();
  API.getConfig().then(cfg => {
    state.config = cfg;
    populateConfigForm(cfg);
  }).catch(() => {});

  switchTab('discover');
  ensureListEntriesLoaded();
  pollNotifications();
  setInterval(pollNotifications, 60000);

})();
