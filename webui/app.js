(function() {
  // App state management
  const state = {
    activeTab: 'watching',
    animeList: [],
    userName: '',
    config: {},
    logs: { selected: 'combined', lines: 250, content: '', available: [] }
  };

  let downloadsCollapsed = false;

  // Toast notifier
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
    searchDebugContainer: document.getElementById('search-debug-container')
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

  // Navigation tabs toggle helper
  function switchTab(target) {
    state.activeTab = target;
    
    // Update desktop buttons style
    DOM.navTabs.forEach(t => {
      if (t.dataset.tab === target) {
        t.className = "nav-tab flex items-center gap-2 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-['Outfit'] active-tab";
      } else {
        t.className = "nav-tab flex items-center gap-2 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-['Outfit']";
      }
    });

    // Update mobile buttons style
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
    
    if (target === 'logs') {
      loadLogs();
      updateSearchDiagnostics();
    }
    if (target === 'settings') loadConfig();
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
      
      const expectedTotal = totalEpisodes > 0 ? (totalEpisodes + startingEpisode) : maxAired;
      const displayProgress = currentProgress + startingEpisode;
      const progressPercent = expectedTotal > 0 ? Math.min(100, Math.round((displayProgress / expectedTotal) * 100)) : 0;
      
      const isFinished = item.media.status === 'FINISHED';
      const isTriggeredGenre = item.media.genres && item.media.genres.includes(triggerGenreVal);
      const hasDownloadedAll = item.downloadedEpisodes.length >= totalEpisodes && totalEpisodes > 0;
      const pendingRewatching = item.pendingRewatchingUpdate === true;

      const card = document.createElement('div');
      card.className = "group overflow-hidden rounded-3xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-[#111827]/75 flex flex-col min-h-[460px] shadow-sm hover:shadow-md hover:border-violet-500/40 dark:hover:border-violet-500/30 hover:scale-[1.01] transition-all duration-300 glow-purple";
      
      const bannerUrl = item.media.coverImage.extraLarge || item.media.coverImage.large || '';
      
      let badgeHTML = '';
      if (isTriggeredGenre) {
        badgeHTML = `<span class="absolute top-4 right-4 bg-violet-600/90 text-white border border-violet-500/50 text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-lg tracking-wider backdrop-blur-sm shadow-md shadow-violet-600/20">${triggerGenreVal}</span>`;
      } else if (item.media.status === 'RELEASING') {
        badgeHTML = `<span class="absolute top-4 right-4 bg-emerald-500/90 text-white border border-emerald-400/50 text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-lg tracking-wider backdrop-blur-sm shadow-md shadow-emerald-600/10">Releasing</span>`;
      } else if (isFinished) {
        badgeHTML = `<span class="absolute top-4 right-4 bg-blue-500/90 text-white border border-blue-400/50 text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-lg tracking-wider backdrop-blur-sm shadow-md shadow-blue-600/10">Finished</span>`;
      }

      const displayTitle = getAnimeTitle(item);
      const subTitle = item.media.title.english || item.media.title.romaji || '';

      card.innerHTML = `
        <div class="h-44 relative bg-slate-900 overflow-hidden flex items-end">
          <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-700" style="background-image: url('${bannerUrl}')"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-[#111827] via-[#111827]/40 to-transparent"></div>
          ${badgeHTML}
          <div class="relative z-10 px-5 pb-4 w-full">
            <h4 class="font-['Outfit'] font-bold text-lg text-white line-clamp-1 leading-snug drop-shadow" title="${displayTitle}">${displayTitle}</h4>
            <p class="text-xs text-slate-300 line-clamp-1 opacity-90">${subTitle}</p>
          </div>
        </div>
        <div class="p-5 flex-grow flex flex-col justify-between gap-5 bg-white dark:bg-transparent">
          
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
        for (let ep = startingEpisode + 1; ep <= expectedTotal; ep++) {
          const badge = document.createElement('button');
          const isDownloaded = item.downloadedEpisodes.includes(ep);
          
          if (isDownloaded) {
            badge.className = "px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-500 transition-all cursor-pointer";
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
        await API.saveAnime(mediaId, payload);
        closeModal(DOM.settingsDialog);
        showToast('Anime overrides saved successfully.');
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
    }
  };

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
      
      card.innerHTML = `
        <div class="flex-grow min-w-0">
          <span class="block font-semibold text-sm text-slate-800 dark:text-slate-200 break-all leading-normal select-all" title="${item.title}">${item.title}</span>
          <div class="flex items-center gap-4 text-xs font-semibold text-slate-400 mt-2">
            <span class="text-emerald-500 flex items-center gap-1"><i class="fa-solid fa-seedling"></i>${item.seeders}</span>
            <span class="flex items-center gap-1"><i class="fa-solid fa-file-zipper"></i>${item.size}</span>
            <span class="text-violet-500 flex items-center gap-1"><i class="fa-solid fa-bolt"></i>${rating}</span>
          </div>
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
                <h4 class="font-bold text-sm sm:text-base font-['Outfit'] text-slate-800 dark:text-slate-200">${trace.anime_title}</h4>
                ${statusBadge}
              </div>
              <p class="text-xs text-slate-400 font-mono">Last Query: <span class="text-slate-500">${trace.search_query}</span></p>
            </div>
            <div class="flex items-center gap-3 text-xs text-slate-400 self-end sm:self-auto">
              <span>${timestampStr}</span>
              ${hasCandidates ? '<i class="fa-solid fa-chevron-down text-xs transition-transform duration-200 chevron-icon"></i>' : ''}
            </div>
          </div>
          <div class="hidden border-t border-slate-200/40 dark:border-slate-800/40 p-5 bg-white dark:bg-slate-950/20">
            <h5 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Evaluated Nyaa Candidate Torrents (Top 3)</h5>
            <div class="space-y-3">
              ${hasCandidates ? trace.candidates.map((c, idx) => {
                const totalScore = c.rating.toFixed(2);
                
                return `
                  <div class="flex flex-col gap-1.5 p-3 rounded-xl border border-slate-100 dark:border-slate-900/60 bg-slate-50/30 dark:bg-slate-900/10">
                    <div class="flex items-start justify-between gap-4">
                      <span class="text-xs font-mono text-slate-600 dark:text-slate-300 break-all">${idx + 1}. ${c.title}</span>
                      <div class="flex items-center gap-2 shrink-0">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-900 text-slate-400">
                          <i class="fa-solid fa-users mr-1"></i>${c.seeders}
                        </span>
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${c.rating >= 3.88 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-400'}">
                          Score: ${totalScore}
                        </span>
                      </div>
                    </div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <i class="fa-solid fa-circle-exclamation text-rose-500/80 shrink-0"></i>
                      <span>Reason: ${c.rejection_reason || 'Score below verification threshold (3.88)'}</span>
                    </div>
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

  DOM.btnRefreshSearchDebug.addEventListener('click', () => {
    updateSearchDiagnostics();
  });

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

  initTheme();
  loadDashboard();
})();
