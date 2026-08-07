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
    discoverSeason: 'SPRING_2026',
    discoverChartTab: 'Airing',
    hideOnMyList: false,
    listsMediaType: 'ANIME',
    listsStatusGroup: 'ALL',
    listsViewMode: 'grid',
    searchQuery: '',
    searchEntity: 'ANIME',
    searchFilters: { format: '', status: '', season: '', year: '', genre: '', onList: '' },
    searchPage: 1,
    searchResults: [],
    searchHasNext: false,
    socialTab: 'feed',
    activeMediaDetail: null,
    activeListEditorMedia: null
  };

  const expandedHistoryIds = new Set();
  let downloadsCollapsed = false;

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
    toast.innerHTML = `<i class="fa-solid ${icon} text-lg shrink-0"></i><p class="flex-grow">${message}</p>`;

    wrapper.appendChild(toast);
    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-4'), 10);
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
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
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (state.config && state.config.bearerTokenAnilist) {
      headers['Authorization'] = `Bearer ${state.config.bearerTokenAnilist}`;
    }
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.errors?.[0]?.message || `AniList GraphQL HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
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
    } else {
      menu.classList.add('mobile-open');
      menu.style.maxHeight = menu.scrollHeight + 'px';
      DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-xmark text-lg';
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
        }
      }
    } catch (e) {
      console.warn('Notifications poll error:', e);
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

    DOM.navTabs.forEach(btn => {
      const match = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active-tab', match);
      btn.classList.toggle('bg-white', match);
      btn.classList.toggle('dark:bg-slate-800', match);
      btn.classList.toggle('text-slate-900', match);
      btn.classList.toggle('dark:text-white', match);
      btn.classList.toggle('shadow-sm', match);
    });

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
    if (DOM.mobileMenu.classList.contains('mobile-open')) {
      DOM.mobileMenu.classList.remove('mobile-open');
      DOM.mobileMenu.style.maxHeight = '0px';
    }

    // Trigger tab specific loader
    if (tabName === 'discover') loadDiscover();
    else if (tabName === 'watching') loadWatching();
    else if (tabName === 'lists') loadLists();
    else if (tabName === 'search') loadSearch();
    else if (tabName === 'social') loadSocial();
    else if (tabName === 'stats') loadStats();
    else if (tabName === 'history') loadHistory();
    else if (tabName === 'logs') loadLogs();
    else if (tabName === 'settings') loadSettings();

    // Notify feature modules of tab switch
    if (window.Animu && window.Animu.bus) {
      window.Animu.bus.emit('tab:switch', tabName);
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
    try {
      const query = `
        query {
          Page(page: 1, perPage: 12) {
            airingSchedules(airingAt_greater: 0, sort: TIME) {
              episode
              airingAt
              media {
                id
                title { romaji english native }
                coverImage { medium }
              }
            }
          }
        }
      `;
      const data = await queryAniList(query);
      const schedules = data.Page.airingSchedules || [];
      if (schedules.length === 0) {
        feed.innerHTML = '<div class="text-slate-400 py-2">No airing schedule available for today.</div>';
        return;
      }
      feed.innerHTML = schedules.map(s => {
        const title = formatTitle(s.media.title);
        const hoursLeft = Math.max(0, Math.round((s.airingAt - Date.now() / 1000) / 3600));
        return `
          <div onclick="openMediaDetail(${s.media.id})" class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shrink-0 cursor-pointer hover:border-violet-500 transition-all">
            <img src="${s.media.coverImage.medium}" class="w-8 h-10 object-cover rounded-lg" />
            <div>
              <p class="font-bold text-slate-800 dark:text-slate-200 line-clamp-1 max-w-[140px]">${title}</p>
              <p class="text-[10px] text-violet-400 font-semibold">Ep ${s.episode} ${hoursLeft > 0 ? `in ~${hoursLeft}h` : 'Airing soon'}</p>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      feed.innerHTML = '<div class="text-slate-400 py-2">Failed to load schedule.</div>';
    }
  }

  async function loadRails() {
    const rails = [
      { id: 'rail-trending', sort: 'TRENDING_DESC', sparkline: true },
      { id: 'rail-popular-season', sort: 'POPULARITY_DESC', season: 'SPRING', year: 2026 },
      { id: 'rail-upcoming', sort: 'POPULARITY_DESC', status: 'NOT_YET_RELEASED' },
      { id: 'rail-all-time', sort: 'POPULARITY_DESC' },
      { id: 'rail-top-100', sort: 'SCORE_DESC' }
    ];

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
        const items = data.Page.media || [];
        container.innerHTML = items.map(m => renderRailCard(m, r.sparkline)).join('');
      } catch (e) {
        container.innerHTML = '<div class="text-slate-400 text-xs py-4">Failed to fetch rail items.</div>';
      }
    }
  }

  function renderRailCard(media, showSparkline = false) {
    const title = formatTitle(media.title);
    const score = media.averageScore ? `${media.averageScore}%` : 'N/A';
    const isDownloaded = state.animeList.some(a => a.mediaId === media.id);

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
          <img src="${media.coverImage.extraLarge || media.coverImage.large}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
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

    try {
      const [season, year] = state.discoverSeason.split('_');
      const query = `
        query ($season: MediaSeason, $seasonYear: Int) {
          Page(page: 1, perPage: 24) {
            media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
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
      const data = await queryAniList(query, { season, seasonYear: parseInt(year) });
      let items = data.Page.media || [];

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
            <img src="${m.coverImage.large}" class="w-20 h-28 object-cover rounded-xl shrink-0 group-hover:scale-105 transition-transform" />
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
      grid.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400 text-sm">Failed to load seasonal chart grid.</div>';
    }
  }


  // ==========================================
  // TAB 2: WATCHING (LOCAL WATCHLIST & SCHEDULER)
  // ==========================================
  async function loadWatching() {
    try {
      const res = await API.getAnime();
      state.userName = res.userName || '';
      state.animeList = res.anime || [];

      if (DOM.userDisplayName) DOM.userDisplayName.textContent = state.userName || 'Otaku';
      renderAnimeGrid(state.animeList);
      loadActiveDownloads();
    } catch (e) {
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
      const title = item.media.alternativeTitle || formatTitle(media.title);
      const cover = media.coverImage?.extraLarge || media.coverImage?.medium || '';
      const totalEp = media.episodes || '?';
      const progress = item.progress || 0;
      const downloaded = item.downloadedEpisodes || [];

      return `
        <div class="group relative rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-[#111827]/80 overflow-hidden shadow-sm hover:shadow-xl hover:border-violet-500/50 transition-all duration-300 flex flex-col">
          <div class="aspect-[16/9] w-full relative overflow-hidden bg-slate-900">
            <img src="${cover}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-transparent to-transparent"></div>

            <div class="absolute top-3 left-3 right-3 flex items-center justify-between">
              <span class="px-2.5 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md text-xs font-bold text-violet-400">
                Ep ${progress} / ${totalEp}
              </span>
              <button onclick="openAnimeSettings(${item.mediaId})" class="w-8 h-8 rounded-xl bg-slate-950/80 backdrop-blur-md text-slate-300 hover:text-white flex items-center justify-center transition-colors">
                <i class="fa-solid fa-gear text-xs"></i>
              </button>
            </div>
          </div>

          <div class="p-5 flex flex-col justify-between flex-grow space-y-4">
            <div>
              <h3 onclick="openMediaDetail(${item.mediaId})" class="font-['Outfit'] font-bold text-base text-slate-900 dark:text-white line-clamp-1 cursor-pointer hover:text-violet-400 transition-colors">${title}</h3>
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
              <button onclick="openNyaaDialog(${item.mediaId})" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-md shadow-violet-500/20 transition-all flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-magnifying-glass"></i>Nyaa Search
              </button>
              <button onclick="openMediaDetail(${item.mediaId})" class="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-circle-info"></i>Details
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadActiveDownloads() {
    try {
      const downloads = await API.getDownloads();
      if (!DOM.downloadsPanel) return;
      if (downloads && downloads.length > 0) {
        DOM.downloadsPanel.classList.remove('hidden');
        DOM.downloadsList.innerHTML = downloads.map(d => `
          <div class="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-sky-500/20 flex items-center justify-between text-xs">
            <div class="space-y-0.5">
              <p class="font-bold text-slate-800 dark:text-slate-200">${d.name}</p>
              <p class="text-sky-400 font-mono">${(d.progress * 100).toFixed(1)}% | ${d.dlspeed ? (d.dlspeed / 1024 / 1024).toFixed(1) : 0} MB/s</p>
            </div>
            <span class="px-2.5 py-1 rounded-xl bg-sky-500/10 text-sky-400 font-bold uppercase tracking-wider text-[10px]">${d.state}</span>
          </div>
        `).join('');
      } else {
        DOM.downloadsPanel.classList.add('hidden');
      }
    } catch (e) {
      console.warn('Failed to load active downloads:', e);
    }
  }


  // ==========================================
  // TAB 3: LISTS (FULL ANILIST COLLECTION)
  // ==========================================
  async function loadLists() {
    // Delegate to feature module if registered
    if (window.Animu && window.Animu.lists && typeof window.Animu.lists.loadLists === 'function') {
      return window.Animu.lists.loadLists();
    }
    // Fallback to legacy inline implementation
    loadUserListsData();
  }

  async function loadUserListsData() {
    const container = document.getElementById('lists-entries-container');
    if (!container) return;

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
      const collections = data.lists || [];

      let allEntries = [];
      collections.forEach(l => {
        l.entries.forEach(e => {
          allEntries.push({ ...e, listName: l.name });
        });
      });

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
                  <button onclick="openListEditor(${e.media.id})" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all">
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
    // Delegate to feature module if registered
    if (window.Animu && window.Animu.lists && typeof window.Animu.lists.quickIncrementProgress === 'function') {
      return window.Animu.lists.quickIncrementProgress(mediaId, currentEp);
    }
    // Fallback to legacy inline implementation
    try {
      const newEp = currentEp + 1;
      const mutation = `
        mutation ($mediaId: Int, $progress: Int) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress) {
            id
            progress
          }
        }
      `;
      await queryAniList(mutation, { mediaId, progress: newEp });
      showToast(`Updated progress to Episode ${newEp}!`);
      loadUserListsData();
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
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.searchQuery = searchInput.value.trim();
        state.searchPage = 1;
        loadSearchResults();
      }, 350);
    });
  }

  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    const drawer = document.getElementById('search-filter-drawer');
    if (drawer) drawer.classList.toggle('hidden');
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
      loadSearchResults();
    });
  });

  async function loadSearch() {
    loadSearchResults();
  }

  async function loadSearchResults() {
    const grid = document.getElementById('search-results-grid');
    if (!grid) return;

    try {
      const entity = state.searchEntity;
      if (entity === 'ANIME' || entity === 'MANGA') {
        const query = `
          query ($search: String, $page: Int, $perPage: Int, $type: MediaType, $format: MediaFormat, $status: MediaStatus, $season: MediaSeason, $seasonYear: Int, $genre: String) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { hasNextPage }
              media(search: $search, type: $type, format: $format, status: $status, season: $season, seasonYear: $seasonYear, genre: $genre, sort: POPULARITY_DESC) {
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
          format: document.getElementById('filter-format')?.value || undefined,
          status: document.getElementById('filter-status')?.value || undefined,
          season: document.getElementById('filter-season')?.value || undefined,
          seasonYear: document.getElementById('filter-year')?.value ? parseInt(document.getElementById('filter-year').value) : undefined,
          genre: document.getElementById('filter-genre')?.value || undefined
        };

        const data = await queryAniList(query, vars);
        const mediaList = data.Page.media || [];
        state.searchHasNext = data.Page.pageInfo.hasNextPage;

        if (mediaList.length === 0) {
          grid.innerHTML = '<div class="col-span-full py-16 text-center text-slate-400 text-sm">No search results found.</div>';
          return;
        }

        grid.innerHTML = mediaList.map(m => {
          const title = formatTitle(m.title);
          const score = m.averageScore ? `${m.averageScore}%` : 'N/A';
          const isDownloaded = state.animeList.some(a => a.mediaId === m.id);

          return `
            <div onclick="openMediaDetail(${m.id})" class="group rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 overflow-hidden hover:border-violet-500 transition-all cursor-pointer flex flex-col shadow-sm">
              <div class="aspect-[2/3] w-full relative overflow-hidden bg-slate-950">
                <img src="${m.coverImage.extraLarge || m.coverImage.large}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
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
        }).join('');

      } else {
        grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-400 text-sm">Entity search for ${entity} active.</div>`;
      }
    } catch (e) {
      grid.innerHTML = '<div class="col-span-full py-16 text-center text-slate-400 text-sm">Failed to fetch search results.</div>';
    }
  }


  // ==========================================
  // TAB 5: SOCIAL HUB (ACTIVITIES & PROFILES)
  // ==========================================
  async function loadSocial() {
    // Delegate to feature module if registered
    if (window.Animu && window.Animu.lists && typeof window.Animu.lists.loadSocial === 'function') {
      return window.Animu.lists.loadSocial();
    }
    // Fallback to legacy inline implementation
    loadActivityFeed();
  }

  async function loadActivityFeed() {
    const list = document.getElementById('activity-feed-list');
    if (!list) return;

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
    // Delegate to feature module if registered
    if (window.Animu && window.Animu.lists && typeof window.Animu.lists.postTextActivity === 'function') {
      return window.Animu.lists.postTextActivity();
    }
    // Fallback to legacy inline implementation
    const input = document.getElementById('activity-input');
    if (!input || !input.value.trim()) return;
    try {
      const mutation = `
        mutation ($text: String) {
          SaveTextActivity(text: $text) {
            id
          }
        }
      `;
      await queryAniList(mutation, { text: input.value.trim() });
      input.value = '';
      showToast('Activity update posted successfully!');
      loadActivityFeed();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });


  // ==========================================
  // TAB 6: STATS (ANALYTICS & BREAKDOWNS)
  // ==========================================
  async function loadStats() {
    const genreContainer = document.getElementById('chart-genre-container');
    const formatContainer = document.getElementById('chart-format-container');

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
      showError(e.message || 'Unknown error');
    }
  }


  // ==========================================
  // TAB 7 & 8: HISTORY & LOGS
  // ==========================================
  async function loadHistory() {
    try {
      const res = await API.getHistory();
      state.history = res.history || [];
      renderHistoryList(state.history);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function renderHistoryList(items) {
    if (!DOM.historyList) return;
    if (items.length === 0) {
      DOM.historyList.innerHTML = '<div class="py-12 text-center text-slate-400 text-sm">No download history available.</div>';
      return;
    }

    DOM.historyList.innerHTML = items.map(item => `
      <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          ${item.cover_image ? `<img src="${item.cover_image}" class="w-10 h-12 object-cover rounded-xl" />` : '<i class="fa-solid fa-download text-violet-500 text-lg"></i>'}
          <div>
            <h4 class="font-['Outfit'] font-bold text-xs text-slate-800 dark:text-slate-200">${item.title}</h4>
            <span class="text-[10px] text-slate-400">${item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Just now'}</span>
          </div>
        </div>
        <button onclick="deleteHistoryEntry('${item.id}')" class="text-rose-500 hover:text-rose-600 p-2"><i class="fa-solid fa-trash"></i></button>
      </div>
    `).join('');
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
    try {
      const res = await API.getLogs(DOM.logSelect.value, DOM.logLines.value);
      DOM.logsBody.textContent = res.content || 'Console log is empty.';
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  DOM.logRefreshBtn?.addEventListener('click', () => loadLogs());


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
        else input.value = cfg[key] ?? '';
      }
    });
  }

  DOM.btnSubmitConfig?.addEventListener('click', async (e) => {
    e.preventDefault();
    const formData = new FormData(DOM.configForm);
    const payload = {};
    formData.forEach((val, key) => {
      const input = DOM.configForm.querySelector(`[name="${key}"]`);
      if (input && input.type === 'checkbox') payload[key] = input.checked;
      else if (input && input.type === 'number') payload[key] = Number(val);
      else payload[key] = val;
    });

    try {
      await API.saveConfig(payload);
      showToast('Configuration hotloaded successfully!');
      loadSettings();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });


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

      const title = formatTitle(m.title);
      const isDownloaded = state.animeList.some(a => a.mediaId === m.id);

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
                    Add / Edit List Entry
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
  window.openListEditor = function(mediaId) {
    // Delegate to feature module if registered
    if (window.Animu && window.Animu.lists && typeof window.Animu.lists.openListEditor === 'function') {
      return window.Animu.lists.openListEditor(mediaId);
    }
    // Fallback to legacy inline implementation
    state.activeListEditorMedia = mediaId;
    document.getElementById('editor-media-id').value = mediaId;
    openModal(DOM.listEditorModal);
  };

  document.getElementById('btn-editor-save')?.addEventListener('click', async () => {
    const mediaId = parseInt(document.getElementById('editor-media-id').value);
    const status = document.getElementById('editor-status').value;
    const progress = parseInt(document.getElementById('editor-progress').value) || 0;
    const score = parseInt(document.getElementById('editor-score').value) || 0;

    try {
      const mutation = `
        mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $scoreRaw: Int) {
          SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, scoreRaw: $scoreRaw) {
            id
            status
            progress
          }
        }
      `;
      await queryAniList(mutation, { mediaId, status, progress, scoreRaw: score * 10 });
      showToast('List entry saved successfully!');
      closeModal(DOM.listEditorModal);
      if (state.activeTab === 'lists') loadUserListsData();
    } catch (e) {
      showToast(e.message, 'error');
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
    const mediaId = DOM.editMediaId.value;
    const alternativeTitle = DOM.editAltTitle.value;
    const startingEpisode = DOM.editStartEp.value;

    try {
      await API.saveAnime(mediaId, { alternativeTitle, startingEpisode });
      showToast('Anime overrides saved successfully.');
      closeModal(DOM.settingsDialog);
      loadWatching();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  DOM.btnResetDownloads.addEventListener('click', async (e) => {
    e.preventDefault();
    const mediaId = DOM.editMediaId.value;
    try {
      await API.resetAnime(mediaId);
      showToast('Downloaded episode cache reset.');
      closeModal(DOM.settingsDialog);
      loadWatching();
    } catch (err) {
      showToast(err.message, 'error');
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
  pollNotifications();
  setInterval(pollNotifications, 60000);

})();
