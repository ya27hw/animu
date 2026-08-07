(function() {
  // App state management
  const state = {
    activeTab: 'watching',
    animeList: [],
    userName: '',
    config: {},
    logs: { selected: 'combined', lines: 250, content: '', available: [] },
    history: [],
    ignored: [],
    discover: {
      rail: 'trending',
      searchQuery: '',
      page: 1,
      lastPage: 1,
      hasNextPage: false,
      items: [],
      loading: false,
      detailMediaId: null,
      detailData: null,
      titleLang: 'romaji'
    }
  };

  const expandedHistoryIds = new Set();

  let downloadsCollapsed = false;

  // Toast notifier
  function showToast(message, type = 'success') {
    const wrapper = document.getElementById('toast-wrapper');
    if (!wrapper) return;

    const toast = document.createElement('div');
    toast.className = `p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-semibold pointer-events-auto transform translate-y-4 opacity-0 transition-all duration-300 ${
    type === 'success'
      ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200/50 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 glow-emerald'
      : type === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/90 border-amber-200/60 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 glow-amber'
        : 'bg-rose-50 dark:bg-rose-950/90 border-rose-200/50 dark:border-rose-900/60 text-rose-800 dark:text-rose-300 glow-rose'
    }`;
    
    const icon = type === 'success'
      ? 'fa-circle-check text-emerald-500'
      : type === 'warning'
        ? 'fa-triangle-exclamation text-amber-500'
        : 'fa-circle-exclamation text-rose-500';
    toast.innerHTML = `<i class="fa-solid ${icon} text-lg shrink-0"></i><p class="flex-grow">${message}</p>`;
    
    wrapper.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.remove('opacity-0', 'translate-y-4');
    }, 10);
    
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // API wrappers
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
    async deleteHistoryItem(id, action = 'delete') {
      const res = await fetch(`/api/history/${id}?action=${encodeURIComponent(action)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete history item.');
      return res.json();
    },
    async getIgnored() {
      const res = await fetch('/api/ignored');
      if (!res.ok) throw new Error('Failed to fetch ignored list.');
      return res.json();
    },
    async addIgnored(title, mediaId) {
      const res = await fetch('/api/ignored', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mediaId })
      });
      if (!res.ok) throw new Error('Failed to add to ignored list.');
      return res.json();
    },
    async deleteIgnored(idOrTitle) {
      const res = await fetch(`/api/ignored/${encodeURIComponent(idOrTitle)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove from ignored list.');
      return res.json();
    },
    async getDiscover(type = 'trending', page = 1) {
      const res = await fetch(`/api/anilist/discover?type=${encodeURIComponent(type)}&page=${page}`);
      if (!res.ok) throw new Error('Failed to load discover feed.');
      return res.json();
    },
    async searchAniList(query, page = 1) {
      const res = await fetch(`/api/anilist/search?q=${encodeURIComponent(query)}&page=${page}`);
      if (!res.ok) throw new Error('Failed to search AniList.');
      return res.json();
    },
    async getMediaDetail(mediaId) {
      const res = await fetch(`/api/anilist/media/${mediaId}`);
      if (!res.ok) throw new Error('Failed to load anime details.');
      return res.json();
    },
    async updateListEntry(mediaId, payload) {
      const res = await fetch('/api/anilist/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId, ...payload })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to update AniList entry.');
      }
      return data;
    }
  };

  // DOM Elements
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
    settingsForm: document.getElementById('settings-form'),
    editMediaId: document.getElementById('edit-media-id'),
    editAltTitle: document.getElementById('edit-alt-title'),
    editStartEp: document.getElementById('edit-start-ep'),
    btnResetDownloads: document.getElementById('btn-reset-downloads'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    settingsTitle: document.getElementById('settings-dialog-title'),
    nyaaTitle: document.getElementById('nyaa-dialog-title'),
    nyaaList: document.getElementById('nyaa-candidates-list'),
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleDesktop: document.getElementById('theme-toggle-desktop'),
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
    discoverSearchInput: document.getElementById('discover-search-input'),
    discoverSearchClear: document.getElementById('discover-search-clear'),
    railBtns: document.querySelectorAll('.rail-btn'),
    discoverGrid: document.getElementById('discover-grid'),
    discoverPagination: document.getElementById('discover-pagination'),
    btnDiscoverPrev: document.getElementById('btn-discover-prev'),
    btnDiscoverNext: document.getElementById('btn-discover-next'),
    discoverPageIndicator: document.getElementById('discover-page-indicator'),
    discoverFeedView: document.getElementById('discover-feed-view'),
    discoverDetailView: document.getElementById('discover-detail-view'),
    btnBackToDiscover: document.getElementById('btn-back-to-discover'),
    detailContentContainer: document.getElementById('detail-content-container'),
    inputAddIgnored: document.getElementById('input-add-ignored'),
    btnAddIgnored: document.getElementById('btn-add-ignored'),
    ignoredListContainer: document.getElementById('ignored-list-container')
  };

  // Light/Dark Theme Switcher
  function initTheme() {
    // Use the Animu settings system (window.Animu.settings) if available,
    // otherwise fall back to direct localStorage (backward compat).
    if (window.Animu && window.Animu.settings) {
      const savedTheme = window.Animu.settings.get('theme', 'dark');
      if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
      } else if (savedTheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } else {
        document.documentElement.classList.add('dark');
      }
    } else {
      const savedTheme = localStorage.getItem('theme') || 'dark';
      if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        document.documentElement.classList.add('dark');
      }
    }
  }

  // Helper: persist theme via Animu settings (with localStorage fallback)
  function persistTheme(theme) {
    if (window.Animu && window.Animu.settings) {
      window.Animu.settings.set('theme', theme);
    }
    localStorage.setItem('theme', theme === 'system' ? 'dark' : theme);
  }

  DOM.themeToggle.addEventListener('click', () => {
    // Cycle: dark -> light -> dark (old behavior, kept for the header toggle)
    const isDark = document.documentElement.classList.toggle('dark');
    persistTheme(isDark ? 'dark' : 'light');
  });
  DOM.themeToggleDesktop.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    persistTheme(isDark ? 'dark' : 'light');
  });

  // Hamburger menu toggle
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

  // Modal handlers
  function openModal(modal) {
    modal.classList.remove('opacity-0', 'pointer-events-none');
    const child = modal.firstElementChild;
    if (child) child.classList.remove('scale-95');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
    const child = modal.firstElementChild;
    if (child) child.classList.add('scale-95');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      closeModal(e.target.closest('#settings-dialog, #nyaa-dialog'));
    });
  });

  window.addEventListener('click', (e) => {
    if (e.target.id === 'settings-dialog' || e.target.id === 'nyaa-dialog') {
      closeModal(e.target);
    }
  });

  // Navigation tabs toggle
  function switchTab(target) {
    state.activeTab = target;

    // Emit tab switch on the Animu event bus (populated by core.js / settings-behavior.js)
    if (window.Animu && window.Animu.bus) {
      window.Animu.bus.emit('tab:switch', target);
    }

    // Update desktop nav buttons style
    DOM.navTabs.forEach(t => {
      if (t.dataset.tab === target) {
        t.className = "nav-tab flex items-center gap-1.5 px-3 sm:px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-['Outfit'] active-tab";
      } else {
        t.className = "nav-tab flex items-center gap-1.5 px-3 sm:px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-['Outfit']";
      }
    });

    // Update mobile nav buttons style
    DOM.mobileNavTabs.forEach(t => {
      if (t.dataset.tab === target) {
        t.className = "mobile-nav-tab w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer bg-violet-600/10 text-violet-700 dark:text-violet-300 font-['Outfit'] active-tab";
      } else {
        t.className = "mobile-nav-tab w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40 font-['Outfit']";
      }
    });

    // Switch views
    DOM.viewPanels.forEach(panel => {
      if (panel.id === `${target}-panel`) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    });

    // Close mobile menu if open
    if (DOM.mobileMenu) {
      DOM.mobileMenu.classList.remove('mobile-open');
      DOM.mobileMenu.style.maxHeight = '0px';
      if (DOM.hamburgerBtn && DOM.hamburgerBtn.querySelector('i')) {
        DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-bars text-lg';
      }
    }

    if (target === 'history') {
      loadAndRenderHistory();
    } else if (target === 'discover') {
      if (state.discover.detailMediaId) {
        if (DOM.discoverFeedView) DOM.discoverFeedView.classList.add('hidden');
        if (DOM.discoverDetailView) DOM.discoverDetailView.classList.remove('hidden');
      } else {
        if (DOM.discoverFeedView) DOM.discoverFeedView.classList.remove('hidden');
        if (DOM.discoverDetailView) DOM.discoverDetailView.classList.add('hidden');
        if (state.discover.items.length === 0) {
          loadDiscoverFeed();
        }
      }
    } else if (target === 'logs') {
      loadLogs();
      updateSearchDiagnostics();
    } else if (target === 'settings') {
      loadConfig();
      loadAndRenderIgnored();
    }
    if (target === 'watching') loadAnime();
  }

  DOM.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  DOM.mobileNavTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Calculate airing numbers
  function getMaxAiredEpisode(anime) {
    const offset = anime.media.startingEpisode || 0;
    if (anime.media.nextAiringEpisode) {
      return Math.max(0, anime.media.nextAiringEpisode.episode - 1 + offset);
    }
    if (anime.media.episodes) {
      return Math.max(0, anime.media.episodes + offset);
    }
    return Math.max(0, (anime.progress || 0) + offset);
  }

  function getAnimeTitle(item) {
    if (!item || !item.media) return 'Unknown';
    return item.media.alternativeTitle || item.media.title.english || item.media.title.romaji || 'Unknown';
  }

  // Draw Anime watchlist
  function renderAnimeGrid() {
    DOM.animeGrid.innerHTML = '';
    if (state.animeList.length === 0) {
      DOM.animeGrid.innerHTML = `
        <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-video-slash text-4xl mb-4 text-slate-300 dark:text-slate-700"></i>
          <p class="font-semibold text-sm">No entries matching watching criteria found.</p>
        </div>
      `;
      return;
    }

    const triggerGenreVal = state.config.triggerGenre || "Ecchi";

    state.animeList.forEach(item => {
      const maxAired = getMaxAiredEpisode(item);
      const currentProgress = item.progress || 0;
      const totalEpisodes = item.media.episodes || 0;
      const startingEpisode = item.media.startingEpisode || 0;
      
      const expectedTotal = totalEpisodes > 0 ? totalEpisodes : Math.max(0, maxAired - startingEpisode);
      const displayProgress = currentProgress;
      const progressPercent = expectedTotal > 0 ? Math.min(100, Math.round((displayProgress / expectedTotal) * 100)) : 0;
      
      const isFinished = item.media.status === 'FINISHED';
      const isTriggeredGenre = item.media.genres && item.media.genres.includes(triggerGenreVal);
      // When AniList does not provide a total, use the aired/derived total so
      // finished shows can still satisfy the rewatch gate.
      const hasDownloadedAll = expectedTotal > 0 && item.downloadedEpisodes.length >= expectedTotal;
      const pendingRewatching = item.pendingRewatchingUpdate === true;

      const card = document.createElement('div');
      card.className = "group overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 flex flex-col min-h-[350px] shadow-sm hover:shadow-md hover:border-violet-500/40 dark:hover:border-violet-500/30 hover:scale-[1.01] transition-all duration-300 glow-purple";
      
      const bannerUrl = item.media.coverImage.extraLarge || item.media.coverImage.large || '';
      
      let badgeHTML = '';
      if (isTriggeredGenre) {
        badgeHTML = `<span class="absolute top-3 right-3 bg-violet-600/90 text-white border border-violet-500/50 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md tracking-wider backdrop-blur-sm shadow-md shadow-violet-600/20">${triggerGenreVal}</span>`;
      } else if (item.media.status === 'RELEASING') {
        badgeHTML = `<span class="absolute top-3 right-3 bg-emerald-500/90 text-white border border-emerald-400/50 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md tracking-wider backdrop-blur-sm shadow-md shadow-emerald-600/10">Releasing</span>`;
      } else if (isFinished) {
        badgeHTML = `<span class="absolute top-3 right-3 bg-blue-500/90 text-white border border-blue-400/50 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md tracking-wider backdrop-blur-sm shadow-md shadow-blue-600/10">Finished</span>`;
      }

      const displayTitle = getAnimeTitle(item);
      const subTitle = item.media.title.english || item.media.title.romaji || '';

      card.innerHTML = `
        <div class="h-32 relative bg-slate-900 overflow-hidden flex items-end">
          <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-700" style="background-image: url('${bannerUrl}')"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/40 to-transparent"></div>
          ${badgeHTML}
          <div class="relative z-10 px-4 pb-3 w-full">
            <h4 class="font-['Outfit'] font-bold text-base text-white line-clamp-1 leading-snug drop-shadow" title="${displayTitle}">${displayTitle}</h4>
            <p class="text-xs text-slate-300 line-clamp-1 opacity-90">${subTitle}</p>
          </div>
        </div>
        <div class="p-3.5 sm:p-4 flex-grow flex flex-col justify-between gap-3.5 bg-white dark:bg-transparent">
          
          <!-- Mid info properties -->
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2 border border-slate-100 dark:border-slate-800/30">
                <span class="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Media ID</span>
                <span class="font-bold text-slate-700 dark:text-slate-200">${item.mediaId}</span>
              </div>
              <div class="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-2 border border-slate-100 dark:border-slate-800/30">
                <span class="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Format</span>
                <span class="font-bold text-slate-700 dark:text-slate-200">${item.media.format || 'TV'}</span>
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="space-y-1.5 pt-1">
              <div class="flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>Progress: ${displayProgress} / ${expectedTotal}</span>
                <span class="font-['Outfit'] text-slate-800 dark:text-slate-200 font-bold">${progressPercent}%</span>
              </div>
              <div class="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/20 dark:border-slate-850">
                <div class="h-full bg-gradient-to-r from-violet-600 via-indigo-500 to-pink-500 rounded-full shadow-[0_0_10px_rgba(139,92,246,0.3)] transition-all duration-500" style="width: ${progressPercent}%"></div>
              </div>
            </div>
          </div>

          <!-- Bottom controls -->
          <div class="space-y-4">
            <div class="space-y-1.5">
              <span class="block text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Episode Cache Status</span>
              <div class="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1" id="badge-grid-${item.mediaId}">
                <!-- Badges loaded dynamically -->
              </div>
            </div>

            <div class="flex gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60">
              <button class="w-10 h-10 shrink-0 flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 rounded-xl text-slate-600 dark:text-slate-300 transition-colors cursor-pointer" onclick="window.UI.showSettings(${item.mediaId})" title="Configure parameters">
                <i class="fa-solid fa-sliders"></i>
              </button>
              <button class="flex-grow h-10 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-md shadow-violet-500/10 cursor-pointer transition-colors" onclick="window.UI.searchNyaaEpisode(${item.mediaId})">
                <i class="fa-solid fa-magnifying-glass"></i>Manual Search
              </button>
              ${isFinished && hasDownloadedAll ? `
                <button class="h-10 px-3.5 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white text-emerald-500 text-xs sm:text-sm font-bold rounded-xl transition-all cursor-pointer ${pendingRewatching ? 'opacity-40 cursor-not-allowed' : ''}" onclick="window.UI.triggerRewatch(${item.mediaId})" ${pendingRewatching ? 'disabled' : ''}>
                  <i class="fa-solid fa-rotate-right"></i>
                </button>
              ` : ''}
            </div>
          </div>

        </div>
      `;

      DOM.animeGrid.appendChild(card);

      // Render episode badge states
      const badgeGrid = document.getElementById(`badge-grid-${item.mediaId}`);
      if (expectedTotal > 0) {
        for (let ep = 1; ep <= expectedTotal; ep++) {
          const badge = document.createElement('button');
          const isDownloaded = item.downloadedEpisodes.includes(ep);
          const hasAired = (ep + startingEpisode) <= maxAired;
          
          if (isDownloaded) {
            badge.className = "px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-500 transition-all cursor-pointer";
          } else if (hasAired) {
            badge.className = "px-2 py-0.5 text-[10px] font-bold rounded bg-red-500/10 dark:bg-red-500/20 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 transition-all cursor-pointer";
          } else {
            badge.className = "px-2 py-0.5 text-[10px] font-bold rounded bg-slate-100 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/40 text-slate-500 dark:text-slate-400 hover:bg-violet-600 hover:text-white dark:hover:bg-violet-600 hover:border-transparent transition-all cursor-pointer";
          }
          
          badge.textContent = ep;
          badge.onclick = () => window.UI.searchNyaaEpisode(item.mediaId, ep);
          badgeGrid.appendChild(badge);
        }
      } else {
        badgeGrid.innerHTML = `<span class="text-xs text-slate-400 font-medium">Waiting airing schedule...</span>`;
      }
    });
  }

  // Interactivity binds
  window.UI = {
    showSettings(mediaId) {
      const anime = state.animeList.find(x => x.mediaId === mediaId);
      if (!anime) return;
      
      DOM.editMediaId.value = mediaId;
      DOM.editAltTitle.value = anime.media.alternativeTitle || '';
      DOM.editStartEp.value = anime.media.startingEpisode || 0;
      DOM.settingsTitle.textContent = getAnimeTitle(anime);
      
      openModal(DOM.settingsDialog);
    },
    async saveOverrides() {
      const mediaId = Number(DOM.editMediaId.value);
      const payload = {
        alternativeTitle: DOM.editAltTitle.value.trim(),
        startingEpisode: Number(DOM.editStartEp.value) || 0
      };
      
      try {
        const data = await API.saveAnime(mediaId, payload);
        closeModal(DOM.settingsDialog);
        if (data && data.synced === false) {
          showToast(data.warning || 'Saved locally. PocketBase sync pending — will retry.', 'warning');
        } else {
          showToast('Anime overrides saved successfully.');
        }
        loadDashboard();
      } catch (e) {
        showToast(e.message, 'error');
      }
    },
    async resetAnime() {
      const mediaId = Number(DOM.editMediaId.value);
      const anime = state.animeList.find(x => x.mediaId === mediaId);
      if (!anime) return;
      
      if (!confirm(`Are you sure you want to clear the downloaded episodes cache for "${getAnimeTitle(anime)}"?`)) {
        return;
      }
      
      try {
        await API.resetAnime(mediaId);
        closeModal(DOM.settingsDialog);
        showToast('Episode database cache cleared.');
        loadDashboard();
      } catch (e) {
        showToast(e.message, 'error');
      }
    },
    async triggerRewatch(mediaId) {
      try {
        const anime = state.animeList.find(x => x.mediaId === mediaId);
        if (anime) anime.pendingRewatchingUpdate = true;
        renderAnimeGrid();
        
        await API.markRewatching(mediaId);
        showToast('Anime watch status changed to rewatching.');
        loadDashboard();
      } catch (e) {
        showToast(e.message, 'error');
        loadDashboard();
      }
    },
    async searchNyaaEpisode(mediaId, episode) {
      const anime = state.animeList.find(x => x.mediaId === mediaId);
      const titleStr = anime ? getAnimeTitle(anime) : 'Nyaa.si';
      
      DOM.nyaaTitle.textContent = `Search: ${titleStr}${episode ? ' (Ep ' + episode + ')' : ''}`;
      DOM.nyaaList.innerHTML = `
        <div class="py-12 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3 text-violet-500"></i>
          <p class="font-semibold text-sm">Querying index providers...</p>
        </div>
      `;
      openModal(DOM.nyaaDialog);
      
      try {
        const data = await API.searchNyaa(mediaId, episode);
        renderCandidates(data.results, mediaId, episode);
      } catch (e) {
        DOM.nyaaList.innerHTML = `
          <div class="py-12 flex flex-col items-center justify-center text-slate-400 text-center">
            <i class="fa-solid fa-triangle-exclamation text-3xl mb-3 text-rose-500"></i>
            <p class="font-semibold text-sm">${e.message}</p>
          </div>
        `;
      }
    },
    async startDownload(mediaId, link, episode) {
      try {
        const btn = document.querySelector(`[data-download-link="${link}"]`);
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
        
        await API.downloadNyaa(mediaId, link, episode);
        closeModal(DOM.nyaaDialog);
        showToast(`Torrent added. Manual progress synced back.`);
        loadDashboard();
      } catch (e) {
        showToast(e.message, 'error');
        loadDashboard();
      }
    },
    showDiscoverDetail(mediaId) {
      openMediaDetail(mediaId);
    },
    async quickAddWatching(mediaId) {
      try {
        const data = await API.updateListEntry(mediaId, { status: 'CURRENT' });
        showToast('Anime added to Watching (CURRENT)! Will poll on next scheduler cycle.');
        const item = state.discover.items.find(x => (x.id || x.mediaId) === mediaId);
        if (item) {
          if (!item.mediaListEntry) item.mediaListEntry = {};
          item.mediaListEntry.status = 'CURRENT';
          renderDiscoverGrid();
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    },
    setTitleLang(lang) {
      state.discover.titleLang = lang;
      renderDiscoverGrid();
      if (state.discover.detailData) {
        renderMediaDetail();
      }
    },
    async saveDetailListEntry(mediaId) {
      const statusSelect = document.getElementById('detail-list-status');
      const progressInput = document.getElementById('detail-list-progress');
      const scoreInput = document.getElementById('detail-list-score');

      const status = statusSelect ? statusSelect.value : 'CURRENT';
      const progress = progressInput ? Number(progressInput.value) || 0 : 0;
      const score = scoreInput ? Number(scoreInput.value) || 0 : 0;

      const btn = document.getElementById('btn-save-detail-entry');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      try {
        const data = await API.updateListEntry(mediaId, { status, progress, score });
        showToast('AniList entry updated successfully!', 'success');

        if (state.discover.detailData) {
          state.discover.detailData.mediaListEntry = {
            id: data.entry ? data.entry.id : null,
            status,
            progress,
            score
          };
          renderMediaDetail();
        }

        const item = state.discover.items.find(x => (x.id || x.mediaId) === mediaId);
        if (item) {
          item.mediaListEntry = { status, progress, score };
          renderDiscoverGrid();
        }
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>Save Entry to AniList';
        }
      }
    }
  };

  // Discover Helper Functions
  function getMediaTitle(title, preferredLang) {
    if (!title) return 'Unknown Title';
    const lang = preferredLang || state.discover.titleLang || 'romaji';
    if (lang === 'english' && title.english) return title.english;
    if (lang === 'native' && title.native) return title.native;
    return title.romaji || title.english || title.native || 'Unknown Title';
  }

  let searchTimeout = null;

  async function loadDiscoverFeed() {
    if (state.discover.loading) return;
    state.discover.loading = true;

    if (DOM.discoverGrid) {
      DOM.discoverGrid.innerHTML = `
        <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-spinner fa-spin text-4xl mb-4 text-violet-500"></i>
          <p class="font-semibold text-sm">Loading discover feed...</p>
        </div>
      `;
    }

    try {
      let data;
      if (state.discover.searchQuery) {
        data = await API.searchAniList(state.discover.searchQuery, state.discover.page);
      } else {
        data = await API.getDiscover(state.discover.rail, state.discover.page);
      }

      const media = data.media || [];
      const pageInfo = data.pageInfo || {};

      state.discover.items = media;
      state.discover.page = pageInfo.currentPage || state.discover.page;
      state.discover.lastPage = pageInfo.lastPage || 1;
      state.discover.hasNextPage = pageInfo.hasNextPage || false;

      renderDiscoverGrid();
      updateDiscoverPagination();
    } catch (e) {
      if (DOM.discoverGrid) {
        DOM.discoverGrid.innerHTML = `
          <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400 text-center">
            <i class="fa-solid fa-triangle-exclamation text-4xl mb-4 text-rose-500"></i>
            <p class="font-semibold text-sm text-slate-300">${e.message}</p>
          </div>
        `;
      }
    } finally {
      state.discover.loading = false;
    }
  }

  function renderDiscoverGrid() {
    if (!DOM.discoverGrid) return;
    DOM.discoverGrid.innerHTML = '';

    if (!state.discover.items || state.discover.items.length === 0) {
      DOM.discoverGrid.innerHTML = `
        <div class="col-span-full py-16 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-compass-slash text-4xl mb-4 text-slate-600"></i>
          <p class="font-semibold text-sm">No anime entries found.</p>
        </div>
      `;
      return;
    }

    state.discover.items.forEach(item => {
      const card = document.createElement('div');
      card.className = "group overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 flex flex-col min-h-[320px] shadow-sm hover:shadow-md hover:border-violet-500/40 dark:hover:border-violet-500/30 hover:scale-[1.01] transition-all duration-300 glow-purple";

      const coverUrl = item.coverImage ? (item.coverImage.extraLarge || item.coverImage.large || item.coverImage.medium || '') : '';
      const primaryTitle = getMediaTitle(item.title);
      const secondaryTitle = item.title ? (item.title.english || item.title.romaji || '') : '';

      const score = (item.averageScore || item.meanScore) ? `${item.averageScore || item.meanScore}%` : 'N/A';
      const format = item.format || 'TV';
      const episodes = item.episodes ? `${item.episodes} eps` : 'Ongoing';

      const listEntry = item.mediaListEntry;
      let listBadge = '';
      if (listEntry && listEntry.status) {
        const statusColors = {
          'CURRENT': 'bg-emerald-500/90 text-white',
          'PLANNING': 'bg-sky-500/90 text-white',
          'COMPLETED': 'bg-blue-500/90 text-white',
          'DROPPED': 'bg-rose-500/90 text-white',
          'PAUSED': 'bg-amber-500/90 text-white',
          'REPEATING': 'bg-purple-500/90 text-white'
        };
        const colorClass = statusColors[listEntry.status] || 'bg-slate-700 text-white';
        listBadge = `<span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider ${colorClass}">${listEntry.status}</span>`;
      }

      const localState = item.localState;
      let localBadge = '';
      if (localState && localState.tracked) {
        const epCount = localState.downloadedEpisodes ? localState.downloadedEpisodes.length : 0;
        localBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-600/20 border border-violet-500/30 text-violet-400"><i class="fa-solid fa-hard-drive mr-1"></i>Tracked (${epCount} downloaded)</span>`;
      }

      card.innerHTML = `
        <div class="h-36 relative bg-slate-900 overflow-hidden flex items-end cursor-pointer" onclick="window.UI.showDiscoverDetail(${item.id})">
          <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-700" style="background-image: url('${coverUrl}')"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/40 to-transparent"></div>
          <div class="absolute top-3 left-3 flex flex-wrap gap-1.5 z-10">
            <span class="bg-black/60 text-yellow-400 border border-yellow-500/30 text-[11px] font-extrabold px-2 py-0.5 rounded-md backdrop-blur-sm">
              <i class="fa-solid fa-star text-[10px] mr-1"></i>${score}
            </span>
          </div>
          <div class="absolute top-3 right-3 flex flex-wrap gap-1.5 z-10">
            ${listBadge}
          </div>
          <div class="relative z-10 px-4 pb-2.5 w-full">
            <h4 class="font-['Outfit'] font-bold text-base text-white line-clamp-1 leading-snug drop-shadow" title="${primaryTitle}">${primaryTitle}</h4>
            <p class="text-xs text-slate-300 line-clamp-1 opacity-90">${secondaryTitle}</p>
          </div>
        </div>
        <div class="p-3.5 sm:p-4 flex-grow flex flex-col justify-between gap-3 bg-white dark:bg-transparent">
          <div class="space-y-3">
            <div class="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>${format} • ${episodes}</span>
              <span>${item.seasonYear || ''} ${item.season || ''}</span>
            </div>
            ${item.genres && item.genres.length > 0 ? `
              <div class="flex flex-wrap gap-1">
                ${item.genres.slice(0, 3).map(g => `<span class="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-md">${g}</span>`).join('')}
              </div>
            ` : ''}
            ${localBadge ? `<div class="pt-1">${localBadge}</div>` : ''}
          </div>

          <div class="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/60">
            <button class="flex-grow h-9 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer" onclick="window.UI.showDiscoverDetail(${item.id})">
              <i class="fa-solid fa-circle-info"></i>Details
            </button>
            ${(!listEntry || listEntry.status !== 'CURRENT') ? `
              <button class="h-9 px-3 flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-md shadow-violet-500/10 cursor-pointer transition-all shrink-0" onclick="window.UI.quickAddWatching(${item.id})" title="Add to Watching (CURRENT)">
                <i class="fa-solid fa-plus"></i><span class="hidden sm:inline">Watching</span>
              </button>
            ` : `
              <button class="h-9 px-3 flex items-center justify-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold rounded-xl shrink-0 cursor-default" title="Currently Watching">
                <i class="fa-solid fa-check"></i><span class="hidden sm:inline">Watching</span>
              </button>
            `}
          </div>
        </div>
      `;

      DOM.discoverGrid.appendChild(card);
    });
  }

  function updateDiscoverPagination() {
    if (DOM.btnDiscoverPrev) DOM.btnDiscoverPrev.disabled = state.discover.page <= 1;
    if (DOM.btnDiscoverNext) DOM.btnDiscoverNext.disabled = !state.discover.hasNextPage && state.discover.page >= state.discover.lastPage;
    if (DOM.discoverPageIndicator) DOM.discoverPageIndicator.textContent = `Page ${state.discover.page} of ${state.discover.lastPage || 1}`;
  }

  async function openMediaDetail(mediaId) {
    state.discover.detailMediaId = mediaId;
    if (DOM.discoverFeedView) DOM.discoverFeedView.classList.add('hidden');
    if (DOM.discoverDetailView) DOM.discoverDetailView.classList.remove('hidden');

    if (DOM.detailContentContainer) {
      DOM.detailContentContainer.innerHTML = `
        <div class="py-20 flex flex-col items-center justify-center text-slate-400">
          <i class="fa-solid fa-spinner fa-spin text-4xl mb-4 text-violet-500"></i>
          <p class="font-semibold text-sm">Loading anime details...</p>
        </div>
      `;
    }

    try {
      const data = await API.getMediaDetail(mediaId);
      if (!data || !data.media) {
        throw new Error('Anime metadata not found.');
      }
      state.discover.detailData = data.media;
      renderMediaDetail();
    } catch (e) {
      if (DOM.detailContentContainer) {
        DOM.detailContentContainer.innerHTML = `
          <div class="py-20 flex flex-col items-center justify-center text-slate-400 text-center">
            <i class="fa-solid fa-triangle-exclamation text-4xl mb-4 text-rose-500"></i>
            <p class="font-semibold text-sm text-slate-300">${e.message}</p>
          </div>
        `;
      }
    }
  }

  function renderMediaDetail() {
    const media = state.discover.detailData;
    if (!media || !DOM.detailContentContainer) return;

    const bannerUrl = media.bannerImage || (media.coverImage ? media.coverImage.extraLarge : '');
    const coverUrl = media.coverImage ? (media.coverImage.extraLarge || media.coverImage.large) : '';
    const primaryTitle = getMediaTitle(media.title, state.discover.titleLang);
    const score = (media.averageScore || media.meanScore) ? `${media.averageScore || media.meanScore}%` : 'N/A';

    const entry = media.mediaListEntry || {};
    const currentStatus = entry.status || 'CURRENT';
    const currentProgress = (entry.progress !== undefined && entry.progress !== null) ? entry.progress : 0;
    const currentScore = entry.score || 0;

    const localState = media.localState || {};

    let descHtml = media.description || 'No description available.';
    descHtml = descHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

    DOM.detailContentContainer.innerHTML = `
      <!-- Hero Banner & Header Card -->
      <div class="relative overflow-hidden rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 shadow-lg glow-purple">
        ${bannerUrl ? `
          <div class="h-48 sm:h-64 relative bg-slate-900 overflow-hidden">
            <div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${bannerUrl}')"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/50 to-transparent"></div>
          </div>
        ` : ''}

        <div class="p-6 sm:p-8 relative z-10 ${bannerUrl ? '-mt-16 sm:-mt-20' : ''}">
          <div class="flex flex-col sm:flex-row gap-6 items-start">
            <img src="${coverUrl}" alt="${primaryTitle}" class="w-32 sm:w-44 h-44 sm:h-60 rounded-2xl object-cover shadow-2xl border-2 border-white dark:border-slate-800 shrink-0" />

            <div class="space-y-4 flex-grow min-w-0">
              <!-- Title & Language Selector -->
              <div class="space-y-2">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <h1 class="text-2xl sm:text-3xl font-extrabold font-['Outfit'] text-slate-900 dark:text-white leading-snug">${primaryTitle}</h1>
                  <!-- Title Language Switcher Buttons -->
                  <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 rounded-xl shrink-0">
                    <button class="lang-btn px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${state.discover.titleLang === 'romaji' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}" onclick="window.UI.setTitleLang('romaji')">Romaji</button>
                    <button class="lang-btn px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${state.discover.titleLang === 'english' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}" onclick="window.UI.setTitleLang('english')">English</button>
                    <button class="lang-btn px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer ${state.discover.titleLang === 'native' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}" onclick="window.UI.setTitleLang('native')">Native</button>
                  </div>
                </div>

                <div class="text-xs text-slate-400 font-medium flex flex-wrap gap-x-4 gap-y-1">
                  ${media.title && media.title.romaji ? `<span><strong>Romaji:</strong> ${media.title.romaji}</span>` : ''}
                  ${media.title && media.title.english ? `<span><strong>English:</strong> ${media.title.english}</span>` : ''}
                  ${media.title && media.title.native ? `<span><strong>Native:</strong> ${media.title.native}</span>` : ''}
                </div>
              </div>

              <!-- Metadata Pills -->
              <div class="flex flex-wrap gap-2 text-xs font-semibold">
                <span class="px-3 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-xl flex items-center gap-1.5"><i class="fa-solid fa-star text-xs"></i>Score: ${score}</span>
                <span class="px-3 py-1 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-xl">${media.format || 'TV'}</span>
                <span class="px-3 py-1 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-xl">${media.episodes ? media.episodes + ' episodes' : 'Ongoing'}</span>
                <span class="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">${media.status || 'UNKNOWN'}</span>
                ${media.seasonYear ? `<span class="px-3 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">${media.season || ''} ${media.seasonYear}</span>` : ''}
              </div>

              <!-- Genres -->
              ${media.genres && media.genres.length > 0 ? `
                <div class="flex flex-wrap gap-1.5 pt-1">
                  ${media.genres.map(g => `<span class="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">${g}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- Detail Grid: Left (Synopsis & Relations) / Right (AniList Manager & Local State) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <!-- Left Column (2 cols): Synopsis & Relations -->
        <div class="lg:col-span-2 space-y-8">

          <!-- Synopsis Card -->
          <div class="p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 space-y-3 shadow-sm">
            <h3 class="font-['Outfit'] font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <i class="fa-solid fa-align-left text-violet-500"></i>Synopsis
            </h3>
            <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">${descHtml}</p>
          </div>

          <!-- Airing Schedule -->
          ${media.nextAiringEpisode ? `
            <div class="p-6 rounded-3xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-950/10 space-y-3">
              <h3 class="font-['Outfit'] font-bold text-lg text-sky-600 dark:text-sky-400 flex items-center gap-2">
                <i class="fa-solid fa-calendar-day animate-pulse"></i>Next Airing Episode
              </h3>
              <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Episode <strong>${media.nextAiringEpisode.episode}</strong> airs in <strong>${formatTimeRemaining(media.nextAiringEpisode.timeUntilAiring)}</strong>.
              </div>
            </div>
          ` : ''}

          <!-- Relations Section -->
          ${media.relations && media.relations.edges && media.relations.edges.length > 0 ? `
            <div class="p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 space-y-4 shadow-sm">
              <h3 class="font-['Outfit'] font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                <i class="fa-solid fa-diagram-project text-violet-500"></i>Relations & Prequel Chain
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                ${media.relations.edges.map(edge => {
                  const node = edge.node;
                  const relType = edge.relationType ? edge.relationType.replace(/_/g, ' ') : 'RELATED';
                  const relCover = node.coverImage ? (node.coverImage.medium || node.coverImage.large) : '';
                  const relTitle = getMediaTitle(node.title, state.discover.titleLang);

                  return `
                    <div class="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800/60 hover:border-violet-500/40 cursor-pointer transition-all" onclick="window.UI.showDiscoverDetail(${node.id})">
                      <img src="${relCover}" alt="${relTitle}" class="w-12 h-16 rounded-xl object-cover shrink-0" />
                      <div class="min-w-0 flex-grow">
                        <span class="block text-[10px] font-extrabold uppercase text-violet-500 tracking-wider">${relType}</span>
                        <h4 class="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate" title="${relTitle}">${relTitle}</h4>
                        <span class="text-[10px] text-slate-400 font-semibold">${node.format || ''}</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

        </div>

        <!-- Right Column (1 col): AniList List Manager & Local Animu State -->
        <div class="space-y-8">

          <!-- AniList List Manager Card -->
          <div class="p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 space-y-5 shadow-sm glow-pink">
            <h3 class="font-['Outfit'] font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <i class="fa-solid fa-pen-to-square text-pink-500"></i>AniList Manager
            </h3>

            <form id="detail-anilist-form" class="space-y-4" onsubmit="event.preventDefault(); window.UI.saveDetailListEntry(${media.id});">
              <div>
                <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">List Status</label>
                <select id="detail-list-status" class="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold outline-none focus:border-violet-500">
                  <option value="CURRENT" ${currentStatus === 'CURRENT' ? 'selected' : ''}>Watching (CURRENT)</option>
                  <option value="PLANNING" ${currentStatus === 'PLANNING' ? 'selected' : ''}>Plan to Watch (PLANNING)</option>
                  <option value="COMPLETED" ${currentStatus === 'COMPLETED' ? 'selected' : ''}>Completed (COMPLETED)</option>
                  <option value="REPEATING" ${currentStatus === 'REPEATING' ? 'selected' : ''}>Rewatching (REPEATING)</option>
                  <option value="PAUSED" ${currentStatus === 'PAUSED' ? 'selected' : ''}>Paused (PAUSED)</option>
                  <option value="DROPPED" ${currentStatus === 'DROPPED' ? 'selected' : ''}>Dropped (DROPPED)</option>
                </select>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Progress (Eps)</label>
                  <input type="number" id="detail-list-progress" min="0" max="${media.episodes || 9999}" value="${currentProgress}" class="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Score (0-100)</label>
                  <input type="number" id="detail-list-score" min="0" max="100" step="0.1" value="${currentScore}" class="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold outline-none focus:border-violet-500" />
                </div>
              </div>

              <button type="submit" id="btn-save-detail-entry" class="w-full py-2.5 bg-gradient-to-r from-violet-600 to-pink-500 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md shadow-violet-500/20 hover:scale-[1.01] active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2">
                <i class="fa-solid fa-cloud-arrow-up"></i>Save Entry to AniList
              </button>
            </form>

            <div class="p-3.5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300 space-y-1">
              <span class="font-bold flex items-center gap-1.5"><i class="fa-solid fa-circle-info"></i>Scheduler Sync Note</span>
              <p class="text-[11px] opacity-90">Setting status to <strong>CURRENT</strong> automatically allows Animu's backend scheduler to discover and download new episodes on its next cycle.</p>
            </div>
          </div>

          <!-- Local Animu State Card -->
          <div class="p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 space-y-4 shadow-sm">
            <h3 class="font-['Outfit'] font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
              <i class="fa-solid fa-server text-indigo-500"></i>Local Animu State
            </h3>

            ${localState.tracked ? `
              <div class="space-y-3 text-xs">
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                  <span class="text-slate-400 font-bold">Tracked Status</span>
                  <span class="text-emerald-500 font-bold">Active in Local DB</span>
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                  <span class="text-slate-400 font-bold">Downloaded Episodes</span>
                  <span class="text-slate-200 font-bold">${localState.downloadedEpisodes ? localState.downloadedEpisodes.length : 0} downloaded</span>
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                  <span class="text-slate-400 font-bold">Starting Ep Offset</span>
                  <span class="text-slate-200 font-bold">${localState.startingEpisode || 0}</span>
                </div>
                ${localState.alternativeTitle ? `
                  <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
                    <span class="text-slate-400 font-bold block mb-0.5">Custom Title Override</span>
                    <span class="text-slate-200 font-bold truncate block">${localState.alternativeTitle}</span>
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/40 text-center space-y-2">
                <i class="fa-solid fa-inbox text-2xl text-slate-500"></i>
                <p class="text-xs text-slate-400">Not currently tracked in local Animu database. Change status to CURRENT on AniList to automatically track.</p>
              </div>
            `}
          </div>

        </div>

      </div>
    `;
  }

  function formatTimeRemaining(seconds) {
    if (!seconds || seconds <= 0) return 'soon';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function renderCandidates(results, mediaId, episode) {
    DOM.nyaaList.innerHTML = '';
    if (!results || results.length === 0) {
      DOM.nyaaList.innerHTML = `
        <div class="py-12 flex flex-col items-center justify-center text-slate-450 text-center">
          <i class="fa-solid fa-skull-crossbones text-3xl mb-3 text-slate-350 dark:text-slate-700"></i>
          <p class="font-semibold text-sm">No seeds matching index filters found.</p>
        </div>
      `;
      return;
    }

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = "flex items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/80 hover:border-violet-500/30 transition-colors duration-200";
      
      const rating = item.score !== null ? `Score: ${item.score.toFixed(2)}` : 'Manual Index Query';
      let detailsHTML = '';
      if (item.details) {
        const d = item.details;
        detailsHTML = `
          <div class="flex flex-wrap gap-1.5 mt-2">
            <span class="px-2 py-0.5 text-[10px] font-bold rounded ${d.episode_match ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}>Episode: ${d.episode_match ? '✅ (1.0)' : '❌ (0.0)'}</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded ${d.resolution_match ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}>Resolution: ${d.resolution_match ? '✅ (1.0)' : '❌ (0.0)'}</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded ${d.air_date_match ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}>Air Date: ${d.air_date_match ? '✅ (1.0)' : '❌ (0.0)'}</span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-500/10 text-slate-400 border border-slate-500/20">Title: ${(d.title_similarity || 0).toFixed(2)} / 1.0</span>
          </div>
        `;
      }
      
      card.innerHTML = `
        <div class="flex-grow min-w-0">
          <span class="block font-semibold text-sm text-slate-800 dark:text-slate-200 break-all leading-normal select-all" title="${item.title}">${item.title}</span>
          <div class="flex items-center gap-4 text-xs font-semibold text-slate-400 mt-2">
            <span class="text-emerald-500 flex items-center gap-1"><i class="fa-solid fa-seedling"></i>${item.seeders}</span>
            <span class="flex items-center gap-1"><i class="fa-solid fa-file-zipper"></i>${item.size}</span>
            <span class="text-violet-500 flex items-center gap-1"><i class="fa-solid fa-bolt"></i>${rating}</span>
          </div>
          ${detailsHTML}
        </div>
        <button class="w-10 h-10 shrink-0 flex items-center justify-center bg-violet-600 hover:bg-violet-700 active:scale-95 text-white rounded-xl shadow-md cursor-pointer transition-all" data-download-link="${item.link}" onclick="window.UI.startDownload(${mediaId}, '${item.link}', ${episode || 'undefined'})">
          <i class="fa-solid fa-arrow-down-long"></i>
        </button>
      `;
      DOM.nyaaList.appendChild(card);
    });
  }

  DOM.btnSaveSettings.onclick = window.UI.saveOverrides;
  DOM.btnResetDownloads.onclick = window.UI.resetAnime;

  // Render Live Logs
  let isLogsLoading = false;
  async function loadLogs() {
    if (isLogsLoading) return;
    try {
      isLogsLoading = true;
      const name = DOM.logSelect.value || state.logs.selected;
      const lines = Number(DOM.logLines.value) || state.logs.lines;
      
      const data = await API.getLogs(name, lines);
      state.logs = data;
      
      // Load Log Select options
      const currentSelected = DOM.logSelect.value || data.selected;
      DOM.logSelect.innerHTML = '';
      data.available.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.key;
        opt.textContent = item.label;
        opt.selected = item.key === currentSelected;
        DOM.logSelect.appendChild(opt);
      });
      
      const isNearBottom = DOM.logsBody.scrollHeight - DOM.logsBody.scrollTop - DOM.logsBody.clientHeight < 80;
      const wasEmpty = DOM.logsBody.textContent === '' || DOM.logsBody.textContent.startsWith('System log');
      
      DOM.logsBody.textContent = data.content || 'System log stream is completely empty.';
      if (wasEmpty || isNearBottom) {
        DOM.logsBody.scrollTop = DOM.logsBody.scrollHeight;
      }
    } catch (e) {
      DOM.logsBody.textContent = 'Exception occurred loading logs: ' + e.message;
    } finally {
      isLogsLoading = false;
    }
  }

  // Set up logs auto-refresh interval
  setInterval(async () => {
    if (state.activeTab === 'logs' && DOM.logAutoRefresh && DOM.logAutoRefresh.checked) {
      await loadLogs();
    }
  }, 2000);

  // Active Downloads Dashboard
  async function updateDownloadsDashboard() {
    try {
      if (!DOM.downloadsPanel || !DOM.downloadsList) return;
      
      const downloads = await API.getDownloads();
      if (!downloads || downloads.length === 0) {
        DOM.downloadsPanel.classList.add('hidden');
        return;
      }
      
      DOM.downloadsPanel.classList.remove('hidden');
      if (downloadsCollapsed) {
        DOM.downloadsList.classList.add('hidden');
        DOM.downloadsToggleIcon.className = 'fa-solid fa-chevron-down text-sm';
      } else {
        DOM.downloadsList.classList.remove('hidden');
        DOM.downloadsToggleIcon.className = 'fa-solid fa-chevron-up text-sm';
      }
      DOM.downloadsList.innerHTML = '';
      
      downloads.forEach(dl => {
        const progress = (dl.progress * 100).toFixed(1);
        const name = dl.name;
        const speed = (dl.dlspeed / (1024 * 1024)).toFixed(2); // MB/s
        const totalSize = (dl.size / (1024 * 1024 * 1024)).toFixed(2); // GB
        
        let eta = 'Unknown';
        if (dl.eta < 86400 * 30 && dl.eta > 0) {
          const h = Math.floor(dl.eta / 3600);
          const m = Math.floor((dl.eta % 3600) / 60);
          const s = dl.eta % 60;
          eta = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
        }
        
        const row = document.createElement('div');
        row.className = "flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/80 rounded-2xl";
        row.innerHTML = `
          <div class="flex-grow space-y-1.5 min-w-0">
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm font-bold truncate text-slate-800 dark:text-slate-200" title="${name}">${name}</span>
              <span class="text-xs font-bold text-sky-500">${progress}%</span>
            </div>
            <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
              <div class="bg-gradient-to-r from-sky-500 to-indigo-500 h-2 rounded-full transition-all duration-300" style="width: ${progress}%"></div>
            </div>
          </div>
          <div class="flex items-center gap-4 text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0 self-end sm:self-center">
            <div class="flex items-center gap-1">
              <i class="fa-solid fa-gauge-high"></i>
              <span>${speed} MB/s</span>
            </div>
            <div class="flex items-center gap-1">
              <i class="fa-solid fa-server"></i>
              <span>${totalSize} GB</span>
            </div>
            <div class="flex items-center gap-1">
              <i class="fa-solid fa-clock"></i>
              <span>ETA: ${eta}</span>
            </div>
          </div>
        `;
        DOM.downloadsList.appendChild(row);
      });
    } catch (e) {
      console.error('Failed to update downloads dashboard:', e);
    }
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function formatFailureReason(reason) {
    const text = String(reason || 'Score below verification threshold (3.88)');
    const parts = text.replace(/^Failed threshold\s*[—-]?\s*/i, '').split(/\s+\|\s+|\s+and\s+/i).filter(Boolean);
    return parts.map(part => `<li class="flex gap-2 items-start"><span class="text-rose-500">•</span><span>${escapeHTML(part.trim())}</span></li>`).join('');
  }

  // Update Search Diagnostics
  async function updateSearchDiagnostics() {
    try {
      if (!DOM.searchDebugContainer) return;
      
      const traces = await API.getSearchDebug();
      if (!traces || traces.length === 0) {
        DOM.searchDebugContainer.innerHTML = `
          <div class="p-5 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/30 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
            All anime search queries completed successfully in the last check cycle.
          </div>
        `;
        return;
      }
      
      DOM.searchDebugContainer.innerHTML = '';
      
      traces.forEach(trace => {
        const itemEl = document.createElement('div');
        itemEl.className = 'border border-slate-200/60 dark:border-slate-800/80 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/20';
        
        const timestampStr = new Date(trace.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        // Status Badge Style
        let statusBadge = '';
        if (trace.status === 'NO_RESULTS') {
          statusBadge = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/10 text-amber-500 uppercase">No RSS Results</span>';
        } else if (trace.status === 'NO_MATCH') {
          statusBadge = '<span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-rose-500/10 text-rose-500 uppercase">No Match Criteria</span>';
        } else {
          statusBadge = `<span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-500/10 text-slate-400 uppercase">${trace.status}</span>`;
        }
        
        const hasCandidates = trace.candidates && trace.candidates.length > 0;
        
        itemEl.innerHTML = `
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none bg-slate-100/50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-colors" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.chevron-icon')?.classList.toggle('rotate-180')">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <h4 class="font-bold text-sm sm:text-base font-['Outfit'] text-slate-800 dark:text-slate-200">${escapeHTML(trace.anime_title)}</h4>
                ${statusBadge}
              </div>
              <p class="text-xs text-slate-400 font-mono">Last Query: <span class="text-slate-500">${escapeHTML(trace.search_query)}</span></p>
            </div>
            <div class="flex items-center gap-3 text-xs text-slate-400 self-end sm:self-auto">
              <span>${timestampStr}</span>
              ${hasCandidates ? '<i class="fa-solid fa-chevron-down text-xs transition-transform duration-200 chevron-icon"></i>' : ''}
            </div>
          </div>
          <div class="hidden border-t border-slate-200/40 dark:border-slate-800/40 p-5 bg-white dark:bg-slate-950/20">
            <h5 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Evaluated Nyaa Candidate Torrents (Top 3)</h5>
            <div class="space-y-4">
              ${hasCandidates ? trace.candidates.map((c, idx) => {
                const totalScore = c.rating.toFixed(2);
                const epMatch = c.episode_match;
                const resMatch = c.resolution_match;
                const airMatch = c.air_date_match;
                const titleSim = (c.title_similarity || 0).toFixed(2);

                // Build bullet-point breakdown
                let breakdownHTML = '';
                if (c.episode_match !== undefined && c.episode_match !== null) {
                  breakdownHTML = `
                    <ul class="space-y-1 text-[11px]">
                      <li class="flex items-center gap-2"><span class="shrink-0 ${epMatch ? 'text-emerald-500' : 'text-red-500'} font-bold w-8">${epMatch ? '✅' : '❌'}</span>Episode Match: <span class="font-semibold">${epMatch ? '1.0' : '0.0'} / 1.0</span></li>
                      <li class="flex items-center gap-2"><span class="shrink-0 ${resMatch ? 'text-emerald-500' : 'text-red-500'} font-bold w-8">${resMatch ? '✅' : '❌'}</span>Resolution: <span class="font-semibold">${resMatch ? '1.0' : '0.0'} / 1.0</span></li>
                      <li class="flex items-center gap-2"><span class="shrink-0 ${airMatch ? 'text-emerald-500' : 'text-red-500'} font-bold w-8">${airMatch ? '✅' : '❌'}</span>Air Date: <span class="font-semibold">${airMatch ? '1.0' : '0.0'} / 1.0</span></li>
                      <li class="flex items-center gap-2"><span class="shrink-0 text-slate-400 font-bold w-8">-</span>Title Similarity: <span class="font-semibold">${titleSim} / 1.0</span></li>
                    </ul>
                  `;
                }
                
                return `
                  <div class="flex flex-col gap-2 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 bg-slate-50/30 dark:bg-slate-900/10">
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0 flex-grow space-y-1.5">
                        <span class="text-xs font-mono text-slate-600 dark:text-slate-300 break-all block">${idx + 1}. ${escapeHTML(c.title)}</span>
                        <div class="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
                          <span><i class="fa-solid fa-seedling mr-0.5 text-emerald-500"></i>${c.seeders}</span>
                          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${c.rating >= 3.88 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-400'}">Score: ${totalScore}</span>
                        </div>
                        ${breakdownHTML}
                        <div class="mt-2 rounded-lg border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-950/20 p-2.5">
                          <div class="text-[10px] font-bold uppercase tracking-wider text-rose-500 mb-1.5">Why this candidate failed</div>
                          <ul class="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">${formatFailureReason(c.rejection_reason)}</ul>
                        </div>
                      </div>
                    </div>
                    ${c.link ? `
                      <div class="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800/60">
                        <button class="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow cursor-pointer transition-all flex items-center gap-1.5 force-download-btn" data-media="${trace.media_id}" data-link="${c.link}" data-episode="${c.episode || ''}">
                          <i class="fa-solid fa-arrow-down-long text-[10px]"></i>Force Download
                        </button>
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('') : `
                <div class="text-center py-2 text-xs text-slate-500 italic">
                  No candidate torrents returned from Nyaa for this query string.
                </div>
              `}
            </div>
          </div>
        `;
        DOM.searchDebugContainer.appendChild(itemEl);
      });
      // Attach force-download handlers
      DOM.searchDebugContainer.querySelectorAll('.force-download-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const mediaId = parseInt(btn.dataset.media);
          const link = btn.dataset.link;
          const episode = btn.dataset.episode ? parseInt(btn.dataset.episode) : undefined;
          btn.disabled = true;
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding...';
          try {
            await API.downloadNyaa(mediaId, link, episode);
            showToast('Torrent force-downloaded and marked as downloaded!', 'success');
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Downloaded';
          } catch (e) {
            showToast(e.message, 'error');
            btn.innerHTML = '<i class="fa-solid fa-arrow-down-long"></i>Force Download';
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      console.error('Failed to update search diagnostics:', e);
    }
  }

  // Set up downloads progress auto-refresh interval
  setInterval(async () => {
    if (state.activeTab === 'watching') {
      await updateDownloadsDashboard();
    }
  }, 4000);

  DOM.logSelect.onchange = loadLogs;
  DOM.logLines.onchange = loadLogs;
  DOM.logRefreshBtn.onclick = loadLogs;

  // Load and Modify Configuration Settings
  async function loadConfig() {
    try {
      const data = await API.getConfig();
      state.config = data;
      
      // Populate inputs dynamically
      Object.keys(data).forEach(key => {
        const input = DOM.configForm.querySelector(`[name="${key}"]`);
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = !!data[key];
          } else {
            input.value = data[key] !== undefined ? data[key] : '';
          }
        }
      });

      // Special release group serialization
      if (data.excludeReleaseGroups && Array.isArray(data.excludeReleaseGroups)) {
        DOM.excludeReleaseGroupsInput.value = data.excludeReleaseGroups.join(', ');
      } else {
        DOM.excludeReleaseGroupsInput.value = '';
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  DOM.btnSubmitConfig.addEventListener('click', async (e) => {
    e.preventDefault();
    const formData = new FormData(DOM.configForm);
    const payload = {};
    
    // Read input fields
    DOM.configForm.querySelectorAll('input[name], select[name]').forEach(input => {
      const name = input.name;
      if (input.type === 'checkbox') {
        payload[name] = input.checked;
      } else if (input.type === 'number') {
        payload[name] = input.value !== '' ? Number(input.value) : undefined;
      } else {
        payload[name] = input.value !== '' ? input.value : undefined;
      }
    });

    // Special parsing for excluded release groups
    const csv = DOM.excludeReleaseGroupsInput.value.trim();
    if (csv) {
      payload.excludeReleaseGroups = csv.split(',').map(x => x.trim()).filter(Boolean);
    } else {
      payload.excludeReleaseGroups = [];
    }

    try {
      DOM.btnSubmitConfig.disabled = true;
      DOM.btnSubmitConfig.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Saving...';
      
      await API.saveConfig(payload);
      showToast('Settings saved. Hotloaded into running server memory!');
      
      await loadConfig();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      DOM.btnSubmitConfig.disabled = false;
      DOM.btnSubmitConfig.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>Save & Hotload';
    }
  });

  DOM.btnTestQbit.addEventListener('click', async () => {
    const qbitUrl = DOM.configForm.querySelector('[name="qbit_url"]').value.trim();
    const username = DOM.configForm.querySelector('[name="username"]').value.trim();
    const password = DOM.configForm.querySelector('[name="password"]').value.trim();
    
    if (!qbitUrl) {
      showToast('qBittorrent Web UI URL is required to test.', 'error');
      return;
    }
    
    try {
      DOM.btnTestQbit.disabled = true;
      DOM.btnTestQbit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Testing...';
      const res = await API.testQbit(qbitUrl, username, password);
      if (res.ok) {
        showToast('qBittorrent connection successful!', 'success');
      } else {
        showToast(`Connection failed: ${res.message || res.error}`, 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      DOM.btnTestQbit.disabled = false;
      DOM.btnTestQbit.innerHTML = '<i class="fa-solid fa-plug-circle-bolt mr-2"></i>Test Connection';
    }
  });

  DOM.btnTestProxy.addEventListener('click', async () => {
    const proxyAddress = DOM.configForm.querySelector('[name="proxyAddress"]').value.trim();
    const proxyPort = DOM.configForm.querySelector('[name="proxyPort"]').value.trim();
    
    if (!proxyAddress || !proxyPort) {
      showToast('Proxy Address and Port are required to test.', 'error');
      return;
    }
    
    try {
      DOM.btnTestProxy.disabled = true;
      DOM.btnTestProxy.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Testing...';
      const res = await API.testProxy(proxyAddress, proxyPort);
      if (res.ok) {
        showToast('Proxy routing test successful!', 'success');
      } else {
        showToast(`Proxy test failed: ${res.error || res.message}`, 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      DOM.btnTestProxy.disabled = false;
      DOM.btnTestProxy.innerHTML = '<i class="fa-solid fa-signal mr-2"></i>Test Connection';
    }
  });

  DOM.btnTestDiscord.addEventListener('click', async () => {
    const webhook = DOM.configForm.querySelector('[name="webhook"]').value.trim();
    if (!webhook) {
      showToast('Discord Webhook URL is required to test.', 'error');
      return;
    }
    try {
      DOM.btnTestDiscord.disabled = true;
      DOM.btnTestDiscord.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Testing...';
      const res = await API.testDiscord(webhook);
      if (res.ok) {
        showToast('Discord test notification sent successfully!', 'success');
      } else {
        showToast(`Discord test failed: ${res.error || res.message}`, 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      DOM.btnTestDiscord.disabled = false;
      DOM.btnTestDiscord.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i>Send Test Notification';
    }
  });

  DOM.downloadsHeader.addEventListener('click', () => {
    downloadsCollapsed = !downloadsCollapsed;
    if (downloadsCollapsed) {
      DOM.downloadsList.classList.add('hidden');
      DOM.downloadsToggleIcon.className = 'fa-solid fa-chevron-down text-sm';
    } else {
      DOM.downloadsList.classList.remove('hidden');
      DOM.downloadsToggleIcon.className = 'fa-solid fa-chevron-up text-sm';
    }
  });

  // History Helper Functions & Rendering
  function formatRelativeTime(isoStr) {
    if (!isoStr) return 'Unknown time';
    try {
      const cleaned = isoStr.replace(" ", "T", 1);
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) return isoStr;
      
      const now = new Date();
      const diffMs = now - date;
      const diffSecs = Math.floor(diffMs / 1000);
      const diffMins = Math.floor(diffSecs / 60);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSecs < 60) return 'Just now';
      if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return isoStr;
    }
  }

  function formatFullDateTime(isoStr) {
    if (!isoStr) return 'N/A';
    try {
      const cleaned = isoStr.replace(" ", "T", 1);
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) return isoStr;
      return date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  }

  async function loadAndRenderHistory() {
    try {
      const data = await API.getHistory();
      state.history = data.history || [];
      renderHistory();
    } catch (e) {
      console.error(e);
      if (DOM.historyList) {
        DOM.historyList.innerHTML = `
          <div class="py-12 text-center text-rose-500 text-sm font-semibold">
            <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 block"></i>
            Failed to load download history: ${e.message}
          </div>
        `;
      }
    }
  }

  function renderHistory() {
    if (!DOM.historyList) return;

    const query = (DOM.historySearchInput?.value || '').toLowerCase().trim();
    let filtered = state.history;

    if (query) {
      filtered = filtered.filter(item => {
        const t = (item.title || '').toLowerCase();
        const a = (item.anime_title || '').toLowerCase();
        const ep = String(item.episode || '').toLowerCase();
        return t.includes(query) || a.includes(query) || ep.includes(query);
      });
    }

    if (filtered.length === 0) {
      DOM.historyList.innerHTML = `
        <div class="p-12 text-center text-slate-400 bg-slate-50 dark:bg-slate-900/30 border border-slate-200/40 dark:border-slate-800/40 rounded-2xl">
          <i class="fa-solid fa-clock-rotate-left text-3xl mb-3 text-slate-300 dark:text-slate-700"></i>
          <p class="font-semibold text-sm">${query ? 'No history entries matched your search query.' : 'No previous downloads recorded.'}</p>
        </div>
      `;
      return;
    }

    DOM.historyList.innerHTML = '';

    filtered.forEach(item => {
      const isExpanded = expandedHistoryIds.has(item.id);
      const relativeTime = formatRelativeTime(item.added_at);
      const fullTime = formatFullDateTime(item.added_at);
      
      const isAuto = item.source === 'auto';
      const sourceBadge = isAuto
        ? `<span class="px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">Auto</span>`
        : `<span class="px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Manual</span>`;

      let domainBadge = 'Nyaa';
      if (item.link && item.link.startsWith('magnet:')) {
        domainBadge = 'Magnet';
      }

      const card = document.createElement('div');
      card.className = "border border-slate-200/60 dark:border-slate-800/80 rounded-2xl overflow-hidden bg-white dark:bg-[#111827]/80 hover:border-violet-500/40 dark:hover:border-violet-500/30 transition-all duration-200 shadow-sm";

      card.innerHTML = `
        <div class="flex items-center justify-between gap-4 p-4 sm:p-5 cursor-pointer select-none bg-slate-50/50 dark:bg-slate-900/40 hover:bg-slate-100/60 dark:hover:bg-slate-900/80 transition-colors" data-history-toggle="${item.id}">
          <div class="flex items-center gap-3.5 min-w-0 flex-grow">
            <div class="w-9 h-9 rounded-xl bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
              <i class="fa-solid fa-download text-sm"></i>
            </div>
            <div class="min-w-0 flex-grow">
              <h4 class="font-bold text-sm sm:text-base font-['Outfit'] text-slate-800 dark:text-slate-100 truncate" title="${item.title}">${item.title}</h4>
              <div class="flex items-center gap-3 text-xs font-semibold text-slate-400 mt-1">
                <span class="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <i class="fa-regular fa-clock text-[11px]"></i>${relativeTime}
                </span>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  ${domainBadge}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3 shrink-0">
            ${sourceBadge}
            <button class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs"></i>
            </button>
          </div>
        </div>

        <div class="${isExpanded ? '' : 'hidden'} border-t border-slate-100 dark:border-slate-800/80 p-5 bg-slate-50/40 dark:bg-slate-950/40 space-y-4">
          
          <div>
            <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Full Torrent Title</span>
            <p class="text-xs sm:text-sm font-semibold font-mono text-slate-800 dark:text-slate-200 select-all break-all bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800">${item.title}</p>
          </div>

          <div>
            <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Torrent Source Link</span>
            <div class="flex items-center gap-2">
              <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="flex-grow text-xs sm:text-sm font-medium font-mono text-violet-600 dark:text-violet-400 hover:underline truncate bg-violet-500/5 dark:bg-violet-500/10 px-3.5 py-2 rounded-xl border border-violet-500/20 flex items-center gap-2">
                <i class="fa-solid fa-up-right-from-square text-xs shrink-0"></i>
                <span class="truncate">${item.link}</span>
              </a>
              <button class="px-3.5 py-2 bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl text-xs shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer" data-copy-link="${item.link}">
                <i class="fa-regular fa-copy"></i>Copy
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            
            <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/60">
              <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Added Timestamp</span>
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">${fullTime}</span>
            </div>

            <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/60">
              <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Anime / Episode</span>
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate block">
                ${item.anime_title || 'N/A'}${item.episode !== null && item.episode !== undefined ? ` (Ep ${item.episode})` : ''}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/60">
              <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Torrent Size</span>
              <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">${item.size || 'Unknown'}</span>
            </div>

            <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/60">
              <span class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Seeders</span>
              <span class="text-xs font-semibold text-emerald-500">${item.seeders || 'N/A'}</span>
            </div>

          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/30 dark:border-slate-800/40">
            ${item.cover_image ? `
              <div class="flex items-center gap-2">
                <img src="${item.cover_image}" class="w-7 h-7 rounded-lg object-cover" alt="Cover" />
                <span class="text-xs font-semibold text-slate-400">${item.anime_title || ''}</span>
              </div>
            ` : '<div></div>'}

            <div class="flex flex-wrap items-center gap-2">
              <button class="px-3 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-500 hover:text-white bg-rose-500/10 border border-rose-500/20 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5" data-delete-history="${item.id}" title="Remove history entry only">
                <i class="fa-solid fa-trash-can text-[11px]"></i>Delete
              </button>
              <button class="px-3 py-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white bg-amber-500/10 border border-amber-500/20 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5" data-rerun-history="${item.id}" title="Remove entry & re-run episode search on next schedule cycle">
                <i class="fa-solid fa-rotate-right text-[11px]"></i>Re-run on Next Schedule
              </button>
              <button class="px-3 py-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-600 hover:text-white bg-violet-500/10 border border-violet-500/20 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5" data-ignore-redownload-history="${item.id}" title="Remove entry, add anime to ignore list & trigger immediate re-download">
                <i class="fa-solid fa-ban text-[11px]"></i>Ignore & Re-download
              </button>
            </div>
          </div>

        </div>
      `;

      const toggleEl = card.querySelector(`[data-history-toggle="${item.id}"]`);
      toggleEl.addEventListener('click', () => {
        if (expandedHistoryIds.has(item.id)) {
          expandedHistoryIds.delete(item.id);
        } else {
          expandedHistoryIds.add(item.id);
        }
        renderHistory();
      });

      const copyBtn = card.querySelector(`[data-copy-link]`);
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(item.link);
          showToast('Torrent link copied to clipboard!', 'success');
        });
      }

      const deleteBtn = card.querySelector(`[data-delete-history="${item.id}"]`);
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await API.deleteHistoryItem(item.id, 'delete');
            state.history = state.history.filter(h => h.id !== item.id);
            expandedHistoryIds.delete(item.id);
            renderHistory();
            showToast('History item removed.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }

      const rerunBtn = card.querySelector(`[data-rerun-history="${item.id}"]`);
      if (rerunBtn) {
        rerunBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete history entry and schedule re-run for next cycle?`)) return;
          try {
            const res = await API.deleteHistoryItem(item.id, 'rerun');
            state.history = state.history.filter(h => h.id !== item.id);
            expandedHistoryIds.delete(item.id);
            renderHistory();
            loadDashboard(); // Refresh anime watchlist progress state
            showToast(res.message || 'History entry deleted & re-run scheduled.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }

      const ignoreRedownloadBtn = card.querySelector(`[data-ignore-redownload-history="${item.id}"]`);
      if (ignoreRedownloadBtn) {
        ignoreRedownloadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete history entry, add anime to ignore list, and trigger immediate re-download?`)) return;
          try {
            const res = await API.deleteHistoryItem(item.id, 'ignore-redownload');
            state.history = state.history.filter(h => h.id !== item.id);
            expandedHistoryIds.delete(item.id);
            renderHistory();
            loadAndRenderIgnored();
            showToast(res.message || 'Entry deleted, added to ignore list, and re-download triggered.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }

      DOM.historyList.appendChild(card);
    });
  }

  if (DOM.historyRefreshBtn) {
    DOM.historyRefreshBtn.addEventListener('click', async () => {
      await loadAndRenderHistory();
      showToast('Download history refreshed.');
    });
  }

  if (DOM.historyClearBtn) {
    DOM.historyClearBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear all download history?')) return;
      try {
        await API.clearHistory();
        state.history = [];
        expandedHistoryIds.clear();
        renderHistory();
        showToast('Download history cleared.');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  if (DOM.historySearchInput) {
    DOM.historySearchInput.addEventListener('input', () => {
      renderHistory();
    });
  }

  // Ignored list logic
  async function loadAndRenderIgnored() {
    if (!DOM.ignoredListContainer) return;
    try {
      const data = await API.getIgnored();
      state.ignored = data.ignored || [];
      renderIgnoredList();
    } catch (e) {
      if (DOM.ignoredListContainer) {
        DOM.ignoredListContainer.innerHTML = `<div class="p-4 text-center text-xs text-rose-500 font-semibold">Failed to load ignored list: ${e.message}</div>`;
      }
    }
  }

  function renderIgnoredList() {
    if (!DOM.ignoredListContainer) return;
    if (!state.ignored || state.ignored.length === 0) {
      DOM.ignoredListContainer.innerHTML = `
        <div class="p-4 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-900/30 border border-slate-200/40 dark:border-slate-800/40 rounded-xl">
          No ignored titles configured.
        </div>
      `;
      return;
    }

    DOM.ignoredListContainer.innerHTML = '';
    state.ignored.forEach(item => {
      const row = document.createElement('div');
      row.className = "flex items-center justify-between gap-3 p-3 bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800/60 rounded-xl text-xs";
      const titleDisplay = item.title || `Media ID ${item.media_id}`;
      const mediaIdBadge = item.media_id ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">ID ${item.media_id}</span>` : '';
      
      row.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0 flex-grow">
          <i class="fa-solid fa-ban text-rose-500 text-sm shrink-0"></i>
          <span class="font-bold text-slate-700 dark:text-slate-200 truncate" title="${titleDisplay}">${titleDisplay}</span>
          ${mediaIdBadge}
        </div>
        <button type="button" class="px-2.5 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500 hover:text-white bg-rose-500/10 border border-rose-500/20 rounded-lg transition-colors cursor-pointer shrink-0 flex items-center gap-1" data-remove-ignored="${item.id || item.title}">
          <i class="fa-solid fa-xmark text-[10px]"></i>Remove
        </button>
      `;

      const removeBtn = row.querySelector('[data-remove-ignored]');
      if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
          try {
            await API.deleteIgnored(item.id || item.media_id || item.title);
            showToast(`Removed '${titleDisplay}' from ignore list.`);
            await loadAndRenderIgnored();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }

      DOM.ignoredListContainer.appendChild(row);
    });
  }

  if (DOM.btnAddIgnored) {
    DOM.btnAddIgnored.addEventListener('click', async () => {
      const val = (DOM.inputAddIgnored?.value || '').trim();
      if (!val) {
        showToast('Please enter a title or Media ID to ignore.', 'warning');
        return;
      }
      try {
        const isNum = /^\d+$/.test(val);
        const title = isNum ? '' : val;
        const mediaId = isNum ? Number(val) : null;
        await API.addIgnored(title, mediaId);
        if (DOM.inputAddIgnored) DOM.inputAddIgnored.value = '';
        showToast(`Added '${val}' to ignore list.`);
        await loadAndRenderIgnored();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Init dashboard load
  async function loadDashboard() {
    try {
      // First query config to get basic tags
      const config = await API.getConfig();
      state.config = config;

      const data = await API.getAnime();
      state.animeList = data.anime;
      state.userName = data.userName;
      
      DOM.userDisplayName.textContent = data.userName || 'Otaku';
      renderAnimeGrid();
      updateDownloadsDashboard();
    } catch (e) {
      console.error(e);
      showToast('Backend offline or initialization error.', 'error');
    }
  }

  if (DOM.discoverSearchInput) {
    DOM.discoverSearchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (DOM.discoverSearchClear) {
        if (val) DOM.discoverSearchClear.classList.remove('hidden');
        else DOM.discoverSearchClear.classList.add('hidden');
      }

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.discover.searchQuery = val.trim();
        state.discover.page = 1;
        loadDiscoverFeed();
      }, 350);
    });
  }

  if (DOM.discoverSearchClear) {
    DOM.discoverSearchClear.addEventListener('click', () => {
      DOM.discoverSearchInput.value = '';
      DOM.discoverSearchClear.classList.add('hidden');
      state.discover.searchQuery = '';
      state.discover.page = 1;
      loadDiscoverFeed();
    });
  }

  if (DOM.railBtns) {
    DOM.railBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.railBtns.forEach(b => {
          b.className = "rail-btn px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-['Outfit']";
        });
        btn.className = "rail-btn px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-['Outfit'] active-rail";

        state.discover.rail = btn.dataset.rail;
        state.discover.searchQuery = '';
        if (DOM.discoverSearchInput) DOM.discoverSearchInput.value = '';
        if (DOM.discoverSearchClear) DOM.discoverSearchClear.classList.add('hidden');
        state.discover.page = 1;
        loadDiscoverFeed();
      });
    });
  }

  if (DOM.btnDiscoverPrev) {
    DOM.btnDiscoverPrev.addEventListener('click', () => {
      if (state.discover.page > 1) {
        state.discover.page--;
        loadDiscoverFeed();
      }
    });
  }

  if (DOM.btnDiscoverNext) {
    DOM.btnDiscoverNext.addEventListener('click', () => {
      state.discover.page++;
      loadDiscoverFeed();
    });
  }

  if (DOM.btnBackToDiscover) {
    DOM.btnBackToDiscover.addEventListener('click', () => {
      state.discover.detailMediaId = null;
      if (DOM.discoverDetailView) DOM.discoverDetailView.classList.add('hidden');
      if (DOM.discoverFeedView) DOM.discoverFeedView.classList.remove('hidden');
    });
  }

  initTheme();

  // Sync initial title language from Animu settings (if available)
  if (window.Animu && window.Animu.settings && typeof window.UI !== 'undefined' && typeof window.UI.setTitleLang === 'function') {
    const savedLang = window.Animu.settings.get('titleLanguage', 'romaji');
    state.discover.titleLang = savedLang;
  }

  loadDashboard();
})();
