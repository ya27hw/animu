/**
 * lists-social.js — AniList Lists + Social feature module.
 *
 * Implements user-data and social surfaces for the T3 frontend:
 *
 *  LISTS:
 *    - Grid / compact / detailed views (stored in localStorage)
 *    - Status group tabs (All, Current, Repeating, Completed, Paused, Dropped, Planning)
 *    - Custom-list tabs with per-list counts (dynamically generated from collection)
 *    - Inline progress + score quick-edit (sandbox-only optimistic updates via Animu.list)
 *    - Sort and filter controls
 *    - Custom-list tabs with counts, inline progress and score quick-edit
 *
 *  SOCIAL:
 *    - User profile with bio, avatar, banner, followers and following counts
 *    - Activity feed: text activity, list-activity; replies and likes
 *    - Follow / unfollow
 *    - Favorites toggle
 *    - Basic PMs (send message activity)
 *    - open-profile event from app.js opens a profile modal
 *
 * Uses Animu.bus to react to 'list-changed' events and Animu.list for
 * sandbox-only updates. View preferences stored in localStorage.
 *
 * Vanilla JS, Tailwind v4 browser classes, FontAwesome — no npm deps, no build step.
 */
(function () {
  "use strict";

  var A = window.Animu;
  if (!A) {
    throw new Error("[Animu.lists-social] core.js must be loaded before lists-social.js");
  }

  /* ==========================================================================
   * View preference persistence (localStorage)
   * ========================================================================== */
  var STORAGE_KEY = "animu-lists-view";
  var SOCIAL_STORAGE_KEY = "animu-social-view";

  var defaultListPrefs = {
    mediaType: "ANIME",
    statusGroup: "ALL",
    viewMode: "grid",
    sortBy: "score",
    searchQuery: "",
  };

  function loadListPrefs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var stored = raw ? JSON.parse(raw) : {};
      return Object.assign({}, defaultListPrefs, stored);
    } catch (e) {
      return Object.assign({}, defaultListPrefs);
    }
  }

  function saveListPrefs(prefs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.error("[lists-social] save prefs error:", e);
    }
  }

  function loadSocialPrefs() {
    try {
      var raw = localStorage.getItem(SOCIAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { activeTab: "feed", profileUser: "" };
    } catch (e) {
      return { activeTab: "feed", profileUser: "" };
    }
  }

  function saveSocialPrefs(prefs) {
    try {
      localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.error("[lists-social] save social prefs error:", e);
    }
  }

  /* ==========================================================================
   * State
   * ========================================================================== */
  var _listState = {
    groups: [],
    entries: [],
    customLists: [],
    statusCounts: {},
    fullCollection: [],
  };
  var _activeListEditorMedia = null;
  var _socialState = {
    activities: [],
    currentUserProfile: null,
    messages: [],
  };

  /* ==========================================================================
   * DOM cache — resolved lazily
   * ========================================================================== */
  var _dom = null;
  function resolveDOM() {
    if (_dom) return _dom;
    _dom = {
      listsPanel: document.getElementById("lists-panel"),
      listsContainer: document.getElementById("lists-entries-container"),
      listsStatusTabs: document.getElementById("lists-status-tabs"),
      listsMediaTypeAnime: document.getElementById("lists-media-type-anime"),
      listsMediaTypeManga: document.getElementById("lists-media-type-manga"),
      listsViewBtns: document.querySelectorAll(".list-view-btn"),
      listsSortSelect: document.getElementById("lists-sort-select"),
      listsSearchInput: document.getElementById("lists-search-input"),
      listEditorModal: document.getElementById("list-editor-modal"),

      socialPanel: document.getElementById("social-panel"),
      socialTabBtns: document.querySelectorAll(".social-tab-btn"),
      socialContentFeed: document.getElementById("social-content-feed"),
      socialContentProfile: document.getElementById("social-content-profile"),
      socialContentMessages: document.getElementById("social-content-messages"),
      activityFeedList: document.getElementById("activity-feed-list"),
      activityInput: document.getElementById("activity-input"),
      btnPostActivity: document.getElementById("btn-post-activity"),
      socialUserSearch: document.getElementById("social-user-search"),
      btnSearchUserProfile: document.getElementById("btn-search-user-profile"),
      userProfileDisplay: document.getElementById("user-profile-display"),
      profileModal: document.getElementById("profile-modal"),
    };
    return _dom;
  }

  /* ==========================================================================
   * LISTS — data fetching & state
   * ========================================================================== */

  /** Format title from media object */
  function formatTitle(titleObj) {
    if (!titleObj) return "Untitled";
    if (typeof titleObj === "string") return titleObj;
    var lang = "romaji";
    if (A.settings && A.settings.get) {
      lang = A.settings.get("titleLanguage", "romaji");
    }
    if (lang === "english" && titleObj.english) return titleObj.english;
    if (lang === "native" && titleObj.native) return titleObj.native;
    return titleObj.romaji || titleObj.english || titleObj.native || "Untitled";
  }

  /** Fetch the full AniList MediaListCollection via Animu.api. */
  async function fetchListEntries() {
    var prefs = loadListPrefs();

    try {
      var data = await A.api.getUserList({ type: prefs.mediaType });

      var groups = [];
      if (data && data.lists && Array.isArray(data.lists)) {
        groups = data.lists;
      } else if (data && Array.isArray(data)) {
        groups = [{ name: "All", isCustomList: false, status: "", entries: data }];
      }

      _listState.groups = groups;

      // Derive custom lists
      var customLists = [];
      groups.forEach(function (g) {
        if (g.isCustomList && g.name && g.entries && g.entries.length > 0) {
          customLists.push({ name: g.name, count: g.entries.length });
        }
      });
      _listState.customLists = customLists;

      // Flatten entries with listName
      var allEntries = [];
      groups.forEach(function (g) {
        (g.entries || []).forEach(function (e) {
          allEntries.push(Object.assign({}, e, { listName: g.name, listIsCustom: g.isCustomList }));
        });
      });

      _listState.fullCollection = allEntries;
      _listState.entries = allEntries;

      A.bus.emit("list:loaded", { count: allEntries.length, entries: allEntries, groups: groups });

      return allEntries;
    } catch (err) {
      console.error("[lists-social] fetchListEntries error:", err);
      A.bus.emit("list:error", { error: err, context: "fetchListEntries" });
      A.ui.toast(err.message || "Failed to load list", "error");
      _listState.entries = [];
      _listState.groups = [];
      _listState.customLists = [];
      _listState.fullCollection = [];
      return [];
    }
  }

  /* ==========================================================================
   * LISTS — status tabs, filtering, sorting, rendering
   * ========================================================================== */

  /** Render the status-group tabs + custom-list tabs with counts */
  function renderStatusTabs() {
    var d = resolveDOM();
    if (!d.listsStatusTabs) return;

    var prefs = loadListPrefs();
    var standardGroups = [
      { key: "ALL", label: "All" },
      { key: "CURRENT", label: "Watching" },
      { key: "REPEATING", label: "Rewatching" },
      { key: "COMPLETED", label: "Completed" },
      { key: "PAUSED", label: "Paused" },
      { key: "DROPPED", label: "Dropped" },
      { key: "PLANNING", label: "Planning" },
    ];

    var html = "";

    standardGroups.forEach(function (g) {
      var count = g.key === "ALL"
        ? _listState.fullCollection.length
        : _listState.fullCollection.filter(function (e) { return e.status === g.key; }).length;
      var active = prefs.statusGroup === g.key;
      var cls = active
        ? "bg-violet-600 text-white shadow-sm"
        : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white";
      html += '<button data-status-group="' + g.key + '" class="list-status-tab px-4 py-2 rounded-xl shrink-0 text-xs font-semibold font-[\'Outfit\'] transition-all ' + cls + '">' + g.label + ' (<span class="cnt-' + g.key.toLowerCase() + '">' + count + '</span>)</button>';
    });

    // Custom list tabs
    _listState.customLists.forEach(function (cl) {
      var active = prefs.statusGroup === cl.name;
      var cls = active
        ? "bg-violet-600 text-white shadow-sm"
        : "bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white";
      var safeName = cl.name.toLowerCase().replace(/\s+/g, "-");
      html += '<button data-status-group="' + cl.name + '" class="list-status-tab px-4 py-2 rounded-xl shrink-0 text-xs font-semibold font-[\'Outfit\'] transition-all ' + cls + '">' + cl.name + ' (<span class="cnt-' + safeName + '">' + cl.count + '</span>)</button>';
    });

    d.listsStatusTabs.innerHTML = html;

    // Re-bind click handlers
    var btns = d.listsStatusTabs.querySelectorAll(".list-status-tab");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.getAttribute("data-status-group");
        var p = loadListPrefs();
        p.statusGroup = group;
        saveListPrefs(p);
        btns.forEach(function (b) {
          b.classList.remove("bg-violet-600", "text-white", "shadow-sm");
          b.classList.add("bg-slate-100", "dark:bg-slate-800", "text-slate-400");
        });
        btn.classList.add("bg-violet-600", "text-white", "shadow-sm");
        btn.classList.remove("bg-slate-100", "dark:bg-slate-800", "text-slate-400");
        renderLists();
      });
    });
  }

  /** Apply status-group, search, and sort filters, then render */
  function renderLists() {
    var d = resolveDOM();
    if (!d.listsContainer) return;

    var prefs = loadListPrefs();
    var entries = _listState.fullCollection.slice();

    // Filter by status group
    if (prefs.statusGroup !== "ALL") {
      var sg = prefs.statusGroup;
      entries = entries.filter(function (e) {
        return e.status === sg || e.listName === sg;
      });
    }

    // Filter by search
    var searchVal = (prefs.searchQuery || "").toLowerCase();
    if (searchVal) {
      entries = entries.filter(function (e) {
        return formatTitle(e.media && e.media.title).toLowerCase().includes(searchVal);
      });
    }

    // Sort
    var sortVal = prefs.sortBy || "score";
    entries.sort(function (a, b) {
      if (sortVal === "score") return (b.score || 0) - (a.score || 0);
      if (sortVal === "title") return formatTitle(a.media && a.media.title).localeCompare(formatTitle(b.media && b.media.title));
      if (sortVal === "progress") return (b.progress || 0) - (a.progress || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    _listState.entries = entries;
    renderStatusTabs();

    if (d.listsSortSelect) d.listsSortSelect.value = sortVal;

    if (entries.length === 0) {
      d.listsContainer.innerHTML =
        '<div class="py-16 text-center text-slate-400 text-sm">' +
        '<i class="fa-solid fa-list text-2xl mb-3 text-slate-300"></i>' +
        '<p>No collection entries matching current filters.</p>' +
        '</div>';
      return;
    }

    if (prefs.viewMode === "compact") {
      renderCompactView(entries);
    } else if (prefs.viewMode === "detailed") {
      renderDetailedView(entries);
    } else {
      renderGridView(entries);
    }
  }

  /** Grid view — card-based with cover images */
  function renderGridView(entries) {
    var d = resolveDOM();
    d.listsContainer.innerHTML =
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">' +
      entries.map(renderGridCard).join("") +
      "</div>";
  }

  /** Compact view — table layout */
  function renderCompactView(entries) {
    var d = resolveDOM();
    d.listsContainer.innerHTML =
      '<div class="overflow-x-auto"><table class="w-full text-left border-collapse text-xs">' +
      '<thead><tr class="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase">' +
      '<th class="py-3 px-4">Title</th><th class="py-3 px-4">Progress</th>' +
      '<th class="py-3 px-4">Score</th><th class="py-3 px-4">Status</th>' +
      '<th class="py-3 px-4 text-right">Quick Edit</th></tr></thead>' +
      '<tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 font-semibold">' +
      entries.map(renderCompactRow).join("") +
      "</tbody></table></div>";
  }

  /** Detailed view — expanded cards with banner */
  function renderDetailedView(entries) {
    var d = resolveDOM();
    d.listsContainer.innerHTML =
      '<div class="space-y-6">' +
      entries.map(renderDetailedCard).join("") +
      "</div>";
  }

  /** Render a grid card */
  function renderGridCard(e) {
    var title = formatTitle(e.media && e.media.title);
    var cover = (e.media && (e.media.coverImage && (e.media.coverImage.extraLarge || e.media.coverImage.large))) || "";
    var score = e.score ? e.score : null;
    var progress = e.progress || 0;
    var status = e.status || "PLANNING";

    return ''
      + '<div class="group p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 hover:border-violet-500 transition-all shadow-sm flex flex-col justify-between">'
      + '<div class="flex gap-3">'
      + '<img src="' + cover + '" class="w-20 h-28 object-cover rounded-xl shrink-0 cursor-pointer" onclick="Animu.lists.openMediaDetail(' + e.mediaId + ')" />'
      + '<div class="space-y-1 flex-grow">'
      + '<h4 onclick="Animu.lists.openMediaDetail(' + e.mediaId + ')" class="font-[\'Outfit\'] font-bold text-xs text-slate-800 dark:text-slate-100 line-clamp-2 cursor-pointer hover:text-violet-400">' + title + '</h4>'
      + '<span class="inline-block px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-[10px] font-bold">' + status + '</span>'
      + '<p class="text-xs text-slate-400 font-semibold pt-1">Ep ' + progress + '</p>'
      + '<p class="text-xs text-amber-400 font-bold"><i class="fa-solid fa-star text-[9px] mr-1"></i>' + (score !== null ? score + '%' : 'N/A') + '</p>'
      + '</div></div>'
      + '<div class="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 mt-3">'
      + '<button onclick="Animu.lists.quickIncrementProgress(' + e.mediaId + ', ' + progress + ')" class="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs transition-all shadow-sm">+1</button>'
      + '<button onclick="Animu.lists.quickEditScore(' + e.mediaId + ', ' + (score !== null ? score : 0) + ')" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all"><i class="fa-solid fa-star"></i></button>'
      + '</div></div>';
  }

  /** Render a compact table row */
  function renderCompactRow(e) {
    var title = formatTitle(e.media && e.media.title);
    var cover = (e.media && e.media.coverImage && e.media.coverImage.large) || "";
    var progress = e.progress || 0;
    var score = e.score ? e.score + '%' : "N/A";
    var status = e.status || "";

    return ''
      + '<tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">'
      + '<td class="py-3 px-4 flex items-center gap-3"><img src="' + cover + '" class="w-8 h-10 object-cover rounded-lg" />'
      + '<span onclick="Animu.lists.openMediaDetail(' + e.mediaId + ')" class="cursor-pointer hover:text-violet-400">' + title + '</span></td>'
      + '<td class="py-3 px-4">' + progress + '</td>'
      + '<td class="py-3 px-4 text-amber-400 font-bold">' + score + '</td>'
      + '<td class="py-3 px-4"><span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-bold">' + status + '</span></td>'
      + '<td class="py-3 px-4 text-right">'
      + '<button onclick="Animu.lists.quickIncrementProgress(' + e.mediaId + ', ' + progress + ')" class="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-bold text-[11px] hover:bg-violet-700"><i class="fa-solid fa-plus"></i></button>'
      + '<button onclick="Animu.lists.quickEditScore(' + e.mediaId + ', ' + (e.score !== null ? e.score : 0) + ')" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-bold text-[11px] ml-1 hover:bg-slate-700"><i class="fa-solid fa-star"></i></button>'
      + '</td></tr>';
  }

  /** Render a detailed card */
  function renderDetailedCard(e) {
    var title = formatTitle(e.media && e.media.title);
    var cover = (e.media && (e.media.coverImage && (e.media.coverImage.extraLarge || e.media.coverImage.large))) || "";
    var banner = (e.media && e.media.bannerImage) || "";
    var score = e.score ? e.score : null;
    var progress = e.progress || 0;
    var totalEp = (e.media && (e.media.episodes || e.media.chapters)) || 0;
    var status = e.status || "PLANNING";
    var progressPct = totalEp > 0 ? Math.round((progress / totalEp) * 100) : 0;

    return ''
      + '<div onclick="Animu.lists.openMediaDetail(' + e.mediaId + ')" class="group relative rounded-3xl border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-[#111827]/80 overflow-hidden shadow-sm hover:shadow-xl hover:border-violet-500/50 transition-all duration-300 cursor-pointer">'
      + '<div class="aspect-[16/9] w-full relative overflow-hidden bg-slate-900">'
      + (banner ? '<img src="' + banner + '" class="w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500" />' : "")
      + '<img src="' + cover + '" class="absolute bottom-[-50px] left-4 w-24 h-32 object-cover rounded-2xl shadow-2xl border-2 border-[#111827]" />'
      + '</div>'
      + '<div class="p-6 pt-8">'
      + '<h3 class="font-[\'Outfit\'] font-bold text-lg text-slate-900 dark:text-white line-clamp-1">' + title + '</h3>'
      + '<span class="inline-block px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-[10px] font-bold mt-2">' + status + '</span>'
      + '<div class="space-y-3 mt-4">'
      + '<div class="flex items-center justify-between text-xs font-semibold text-slate-500"><span>Progress: ' + progress + ' / ' + (totalEp || "?") + '</span><span class="font-[\'Outfit\'] text-slate-800 dark:text-slate-200">' + progressPct + '%</span></div>'
      + '<div class="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/20 dark:border-slate-850">'
      + '<div class="h-full bg-gradient-to-r from-violet-600 via-indigo-500 to-pink-500 rounded-full shadow-[0_0_10px_rgba(139,92,246,0.3)] transition-all duration-500" style="width:' + progressPct + '%"></div></div>'
      + '</div>'
      + '<div class="flex gap-2 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">'
      + '<button onclick="event.stopPropagation(); Animu.lists.quickIncrementProgress(' + e.mediaId + ', ' + progress + ')" class="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-sm"><i class="fa-solid fa-plus mr-1"></i>+1 Ep</button>'
      + '<button onclick="event.stopPropagation(); Animu.lists.quickEditScore(' + e.mediaId + ', ' + (score !== null ? score : 0) + ')" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"><i class="fa-solid fa-star mr-1"></i>Score</button>'
      + '</div></div></div>';
  }

  /* ==========================================================================
   * LISTS — quick-edit (sandbox-only via Animu.list.updateListEntry)
   * ========================================================================== */

  /** Increment progress by 1 (sandbox optimistic update) */
  function quickIncrementProgress(mediaId, currentProgress) {
    var mediaIdNum = Number(mediaId);
    var newProgress = (currentProgress || 0) + 1;

    // Sandbox optimistic update
    if (A.list && A.list.updateListEntry) {
      A.list.updateListEntry(mediaIdNum, { progress: newProgress });
    }

    // Update in-memory entries
    _listState.fullCollection.forEach(function (e) {
      if (Number(e.mediaId) === mediaIdNum) {
        e.progress = newProgress;
      }
    });

    A.bus.emit("list-changed", {
      action: "quick-progress",
      mediaId: mediaIdNum,
      payload: { progress: newProgress },
    });

    renderLists();
  }

  /** Open a quick score-edit modal */
  function quickEditScore(mediaId, currentScore) {
    var mediaIdNum = Number(mediaId);

    // Create or reuse a quick-edit modal
    var modal = document.getElementById("quick-score-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "quick-score-modal";
      modal.className = "fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[90] flex items-center justify-center p-4 opacity-0 pointer-events-none transition-all duration-300";
      modal.innerHTML =
        '<div class="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-sm shadow-2xl scale-95 transition-transform duration-300">'
        + '<div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">'
        + '<h3 class="text-lg font-bold font-[\'Outfit\']">Quick Score Edit</h3>'
        + '<button class="text-slate-400 hover:text-slate-200 text-lg dialog-close" data-close><i class="fa-solid fa-xmark"></i></button>'
        + '</div>'
        + '<div class="p-6 space-y-4">'
        + '<div><label class="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Score (0-100)</label>'
        + '<input type="number" id="quick-score-input" min="0" max="100" value="0" class="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-center text-sm font-bold outline-none focus:border-violet-500" /></div>'
        + '<div class="flex justify-end gap-2 pt-2">'
        + '<button class="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold" data-close>Cancel</button>'
        + '<button id="quick-score-save" class="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold">Save</button>'
        + '</div></div></div>';
      document.body.appendChild(modal);

      modal.addEventListener("click", function (e) {
        if (e.target === modal) { A.ui.closeModal(modal); }
      });
      modal.querySelectorAll("[data-close]").forEach(function (btn) {
        btn.addEventListener("click", function () { A.ui.closeModal(modal); });
      });
    }

    var input = modal.querySelector("#quick-score-input");
    input.value = currentScore || 0;

    var saveBtn = modal.querySelector("#quick-score-save");
    saveBtn.onclick = function () {
      var score = parseInt(input.value, 10) || 0;

      // Sandbox optimistic update via Animu.list
      if (A.list && A.list.updateListEntry) {
        A.list.updateListEntry(mediaIdNum, { score: score });
      }

      _listState.fullCollection.forEach(function (e) {
        if (Number(e.mediaId) === mediaIdNum) {
          e.score = score;
        }
      });

      A.bus.emit("list-changed", {
        action: "quick-score",
        mediaId: mediaIdNum,
        payload: { score: score },
      });

      renderLists();
      A.ui.closeModal(modal);
    };

    A.ui.openModal(modal);
  }

  /** Open the full list-editor modal */
  function openListEditor(mediaId) {
    var d = resolveDOM();
    if (!d.listEditorModal) return;

    var entry = _listState.fullCollection.find(function (e) {
      return Number(e.mediaId) === Number(mediaId);
    }) || {};
    _activeListEditorMedia = mediaId;

    document.getElementById("editor-media-id").value = mediaId;
    document.getElementById("editor-status").value = entry.status || "PLANNING";
    document.getElementById("editor-progress").value = entry.progress || 0;
    document.getElementById("editor-score").value = entry.score || 0;
    document.getElementById("editor-start-date").value = entry.startDate || "";
    document.getElementById("editor-finish-date").value = entry.completedAt ? entry.completedAt.split("T")[0] : "";
    document.getElementById("editor-notes").value = entry.notes || "";
    document.getElementById("editor-repeat").value = entry.repeat || 0;

    A.ui.openModal(d.listEditorModal);
  }

  /** Save from list-editor modal */
  async function saveListEntry() {
    var d = resolveDOM();
    var mediaId = parseInt(document.getElementById("editor-media-id").value, 10);
    var payload = {
      status: document.getElementById("editor-status").value,
      progress: parseInt(document.getElementById("editor-progress").value, 10) || 0,
      score: parseInt(document.getElementById("editor-score").value, 10) || 0,
      notes: document.getElementById("editor-notes").value || "",
      repeat: parseInt(document.getElementById("editor-repeat").value, 10) || 0,
    };

    try {
      if (A.list && A.list.updateListEntry) {
        A.list.updateListEntry(mediaId, payload);
      }
      if (A.api && A.api.updateListEntry) {
        await A.api.updateListEntry(mediaId, payload);
      }

      A.bus.emit("list-changed", { action: "save", mediaId: mediaId, payload: payload });

      A.ui.closeModal(d.listEditorModal);
      A.ui.toast("List entry saved successfully!");
      await loadLists();
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Open media detail (delegate to app.js) */
  function openMediaDetail(mediaId) {
    if (window.openMediaDetail) {
      window.openMediaDetail(mediaId);
    }
  }

  /* ==========================================================================
   * LISTS — main load + event binding
   * ========================================================================== */

  async function loadLists() {
    var d = resolveDOM();
    if (!d.listsPanel) return;

    await fetchListEntries();

    var prefs = loadListPrefs();

    // Sync media type toggle buttons
    if (d.listsMediaTypeAnime && d.listsMediaTypeManga) {
      if (prefs.mediaType === "ANIME") {
        d.listsMediaTypeAnime.classList.add("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeManga.classList.remove("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeManga.classList.add("text-slate-400");
      } else {
        d.listsMediaTypeManga.classList.add("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeAnime.classList.remove("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeAnime.classList.add("text-slate-400");
      }
    }

    // Sync view mode buttons
    if (d.listsViewBtns) {
      d.listsViewBtns.forEach(function (btn) {
        btn.classList.toggle("active-view", btn.getAttribute("data-list-view") === prefs.viewMode);
        btn.classList.toggle("bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm",
          btn.getAttribute("data-list-view") === prefs.viewMode);
      });
    }

    if (d.listsSortSelect) d.listsSortSelect.value = prefs.sortBy || "score";

    renderStatusTabs();
    renderLists();
  }

  /** Bind list UI event handlers */
  function bindListEvents() {
    var d = resolveDOM();

    // Media type switch
    if (d.listsMediaTypeAnime) {
      d.listsMediaTypeAnime.addEventListener("click", function () {
        var prefs = loadListPrefs();
        prefs.mediaType = "ANIME";
        saveListPrefs(prefs);
        d.listsMediaTypeAnime.classList.add("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeManga.classList.remove("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeManga.classList.add("text-slate-400");
        loadLists();
      });
    }
    if (d.listsMediaTypeManga) {
      d.listsMediaTypeManga.addEventListener("click", function () {
        var prefs = loadListPrefs();
        prefs.mediaType = "MANGA";
        saveListPrefs(prefs);
        d.listsMediaTypeManga.classList.add("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeAnime.classList.remove("bg-violet-600", "text-white", "shadow-sm");
        d.listsMediaTypeAnime.classList.add("text-slate-400");
        loadLists();
      });
    }

    // View mode buttons
    if (d.listsViewBtns) {
      d.listsViewBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var mode = btn.getAttribute("data-list-view");
          var prefs = loadListPrefs();
          prefs.viewMode = mode;
          saveListPrefs(prefs);
          d.listsViewBtns.forEach(function (b) {
            b.classList.remove("bg-white", "dark:bg-slate-700", "text-slate-900", "dark:text-white", "shadow-sm", "active-view");
            b.classList.add("text-slate-400");
          });
          btn.classList.add("bg-white", "dark:bg-slate-700", "text-slate-900", "dark:text-white", "shadow-sm", "active-view");
          renderLists();
        });
      });
    }

    // Sort select
    if (d.listsSortSelect) {
      d.listsSortSelect.addEventListener("change", function () {
        var prefs = loadListPrefs();
        prefs.sortBy = d.listsSortSelect.value;
        saveListPrefs(prefs);
        renderLists();
      });
    }

    // Search input (debounced)
    if (d.listsSearchInput) {
      var searchTimer = null;
      d.listsSearchInput.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          var prefs = loadListPrefs();
          prefs.searchQuery = d.listsSearchInput.value.trim();
          saveListPrefs(prefs);
          renderLists();
        }, 350);
      });
    }

    // List editor save
    var btnSave = document.getElementById("btn-editor-save");
    if (btnSave) btnSave.onclick = saveListEntry;

    // List editor delete
    var btnDelete = document.getElementById("btn-editor-delete");
    if (btnDelete) {
      btnDelete.onclick = async function () {
        var mediaId = parseInt(document.getElementById("editor-media-id").value, 10);
        if (!confirm("Remove this entry from your list?")) return;
        try {
          if (A.list && A.list.updateListEntry) {
            A.list.updateListEntry(mediaId, { status: "DROPPED" });
          }
          A.bus.emit("list-changed", { action: "delete", mediaId: mediaId });
          _listState.fullCollection = _listState.fullCollection.filter(function (e) {
            return Number(e.mediaId) !== mediaId;
          });
          A.ui.closeModal(d.listEditorModal);
          A.ui.toast("Entry removed (sandbox).");
          renderLists();
        } catch (e) {
          A.ui.toast(e.message, "error");
        }
      };
    }
  }

  /* ==========================================================================
   * SOCIAL — activity feed, user profiles, follow, favorites, PMs
   * ========================================================================== */

  /** Main social load */
  async function loadSocial() {
    var d = resolveDOM();
    if (!d.socialPanel) return;

    var prefs = loadSocialPrefs();

    // Sync social tab buttons
    if (d.socialTabBtns) {
      d.socialTabBtns.forEach(function (btn) {
        var isActive = btn.getAttribute("data-social-tab") === prefs.activeTab;
        btn.classList.toggle("active-social-tab", isActive);
        if (isActive) {
          btn.classList.add("bg-violet-600", "text-white", "shadow-sm");
        } else {
          btn.classList.remove("bg-violet-600", "text-white", "shadow-sm");
          btn.classList.add("text-slate-400");
        }
      });
    }

    if (d.socialContentFeed) d.socialContentFeed.classList.toggle("hidden", prefs.activeTab !== "feed");
    if (d.socialContentProfile) d.socialContentProfile.classList.toggle("hidden", prefs.activeTab !== "profile");
    if (d.socialContentMessages) d.socialContentMessages.classList.toggle("hidden", prefs.activeTab !== "messages");

    if (prefs.activeTab === "feed") {
      await loadActivityFeed();
    }
  }

  /** Fetch and render the activity feed */
  async function loadActivityFeed() {
    var d = resolveDOM();
    if (!d.activityFeedList) return;

    try {
      var data = await A.api.getActivity({ type: "following", page: 1 });
      var activities = (data && (data.activities || data.Page && data.Page.activities)) || [];

      _socialState.activities = activities;

      if (activities.length === 0) {
        d.activityFeedList.innerHTML = '<div class="py-8 text-center text-slate-400 text-xs">No recent activity posts.</div>';
        return;
      }

      d.activityFeedList.innerHTML = activities.map(renderActivityCard).join("");
    } catch (e) {
      console.error("[lists-social] loadActivityFeed error:", e);
      d.activityFeedList.innerHTML = '<div class="py-8 text-center text-slate-400 text-xs">Failed to load activity feed.</div>';
    }
  }

  /** Render a single activity card */
  function renderActivityCard(act) {
    if (!act.user) return "";
    var isText = act.type === "TEXT" || act.text;
    var avatar = (act.user.avatar && (act.user.avatar.medium || act.user.avatar.large)) || "/no-avatar.png";
    var username = act.user.name || "anon";
    var likeCount = act.likeCount || 0;
    var replyCount = act.replyCount || 0;
    var mediaTitle = act.media && act.media.title ? formatTitle(act.media.title) : "";
    var progress = act.progress || 0;
    var activityText = isText ? (act.text || "") : (act.status || "") + (progress ? " ep " + progress + " of " : "") + mediaTitle;
    var timeStr = act.createdAt ? new Date(act.createdAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

    return ''
      + '<div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 space-y-3" data-activity-id="' + act.id + '">'
      + '<div class="flex items-center justify-between">'
      + '<div class="flex items-center gap-3">'
      + '<img src="' + avatar + '" class="w-9 h-9 rounded-xl object-cover" />'
      + '<div><h4 class="font-[\'Outfit\'] font-bold text-xs text-slate-800 dark:text-slate-200" onclick="Animu.lists.openUserProfile(' + act.userId + ')" class="cursor-pointer hover:text-violet-400">' + username + '</h4>'
      + '<span class="text-[10px] text-slate-400">' + timeStr + '</span></div>'
      + '</div>'
      + '<button onclick="Animu.lists.toggleLikeActivity(' + act.id + ')" class="px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white font-bold text-[11px] transition-all flex items-center gap-1">'
      + '<i class="fa-solid fa-heart"></i>' + likeCount +
      + '</button></div>'
      + '<p class="text-xs text-slate-700 dark:text-slate-300 font-medium">' + activityText + '</p>'
      + '<div class="flex items-center gap-4 text-[10px] text-slate-400">'
      + '<button onclick="Animu.lists.toggleReplyActivity(' + act.id + ')" class="flex items-center gap-1 hover:text-violet-400">'
      + '<i class="fa-solid fa-comment"></i>' + replyCount + ' replies</button>'
      + '</div></div>';
  }

  /** Toggle like on an activity */
  async function toggleLikeActivity(activityId) {
    try {
      await A.api.toggleLike(activityId, "ACTIVITY");
      A.bus.emit("list-changed", { action: "like-activity", activityId: activityId });
      await loadActivityFeed();
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Open reply input for an activity */
  function toggleReplyActivity(activityId) {
    var card = document.querySelector('[data-activity-id="' + activityId + '"]');
    if (!card) return;

    var replyBox = card.querySelector(".reply-box");
    if (replyBox) {
      replyBox.remove();
      return;
    }

    replyBox = document.createElement("div");
    replyBox.className = "reply-box mt-2";
    replyBox.innerHTML =
      '<div class="flex gap-2">'
      + '<input type="text" placeholder="Write a reply..." class="flex-grow bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs outline-none focus:border-violet-500" />'
      + '<button onclick="Animu.lists.submitReply(' + activityId + ', this)" class="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold">Reply</button>'
      + '</div>';
    card.appendChild(replyBox);
  }

  /** Submit a reply */
  async function submitReply(activityId, btn) {
    var input = btn.closest(".reply-box").querySelector("input");
    var text = input.value.trim();
    if (!text) return;
    try {
      await A.api.replyActivity(activityId, text);
      A.ui.toast("Reply posted!");
      input.value = "";
      await loadActivityFeed();
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Post a new text activity */
  async function postTextActivity() {
    var d = resolveDOM();
    if (!d.activityInput || !d.activityInput.value.trim()) return;
    try {
      await A.api.postTextActivity(d.activityInput.value.trim());
      d.activityInput.value = "";
      A.ui.toast("Activity posted!");
      await loadActivityFeed();
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Open user profile (from social search or profile tab content) */
  async function openUserProfile(userId) {
    var d = resolveDOM();
    if (!d.userProfileDisplay) return;

    var query = userId;
    var data;

    try {
      data = await A.api.getUser(query);
    } catch (e) {
      console.error("[lists-social] openUserProfile error:", e);
      d.userProfileDisplay.classList.remove("hidden");
      d.userProfileDisplay.innerHTML = '<div class="py-8 text-center text-slate-400 text-sm">Failed to load user profile.</div>';
      return;
    }

    var user = data.User || data || {};
    _socialState.currentUserProfile = user;

    var avatar = (user.avatar && (user.avatar.large || user.avatar.medium)) || "";
    var banner = user.bannerImage || "";
    var bio = user.about ? user.about.replace(/<[^>]+>/g, "") : "No bio available.";
    var followers = user.followers || 0;
    var following = user.following || 0;
    var stats = user.stats || {};
    var animeCompleted = stats.animeCompleted || 0;
    var animeMeanScore = stats.animeMeanScore || 0;

    d.userProfileDisplay.classList.remove("hidden");
    d.userProfileDisplay.innerHTML =
      '<div class="relative">'
      + (banner ? '<img src="' + banner + '" class="w-full h-32 object-cover rounded-xl" />' : "")
      + '<div class="flex items-center gap-4 ' + (banner ? "pt-[-50px]" : "") + '">'
      + (avatar ? '<img src="' + avatar + '" class="w-20 h-20 rounded-full object-cover border-4 border-white dark:border-[#111827]" />' : "")
      + '<div class="space-y-1 flex-grow">'
      + '<h3 class="font-[\'Outfit\'] font-bold text-xl text-slate-900 dark:text-white">' + (user.name || query) + '</h3>'
      + '<p class="text-xs text-slate-400">@' + (user.name || query) + '</p>'
      + '</div>'
      + '<button onclick="Animu.lists.toggleFollow(' + user.id + ')" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-all">'
      + '<i class="fa-solid fa-user-plus mr-1"></i>Follow</button>'
      + '</div>'
      + '<div class="mt-4 space-y-3">'
      + '<div class="flex gap-6 text-center text-xs">'
      + '<div><span class="font-bold text-slate-900 dark:text-white">' + followers + '</span><p class="text-slate-400">Followers</p></div>'
      + '<div><span class="font-bold text-slate-900 dark:text-white">' + following + '</span><p class="text-slate-400">Following</p></div>'
      + '<div><span class="font-bold text-slate-900 dark:text-white">' + animeCompleted + '</span><p class="text-slate-400">Completed</p></div>'
      + '<div><span class="font-bold text-slate-900 dark:text-white">' + animeMeanScore + '%</span><p class="text-slate-400">Mean Score</p></div>'
      + '</div>'
      + '<div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/40">'
      + '<p class="text-xs text-slate-600 dark:text-slate-300">' + bio + '</p>'
      + '</div></div></div>';

    // Switch to profile tab view
    var prefs = loadSocialPrefs();
    prefs.profileUser = user.name || "";
    saveSocialPrefs(prefs);
  }

  /** Toggle follow on a user */
  async function toggleFollow(userId) {
    try {
      await A.api.toggleFollow(userId);
      A.ui.toast("Follow status updated!");
      var d = resolveDOM();
      if (d.userProfileDisplay) {
        var btn = d.userProfileDisplay.querySelector("button[onclick*='toggleFollow']");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-user-check mr-1"></i>Following';
      }
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Toggle favourite on a media */
  async function toggleFavourite(id, type) {
    try {
      await A.api.toggleFavourite(id, type);
      A.ui.toast("Favourite updated!");
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Send a private message to a user */
  async function sendPrivateMessage(userId, text) {
    try {
      await A.api.sendMessageActivity(userId, text);
      A.ui.toast("Message sent!");
    } catch (e) {
      A.ui.toast(e.message, "error");
    }
  }

  /** Bind social UI event handlers */
  function bindSocialEvents() {
    var d = resolveDOM();

    // Social tab buttons
    if (d.socialTabBtns) {
      d.socialTabBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          var tab = btn.getAttribute("data-social-tab");
          var prefs = loadSocialPrefs();
          prefs.activeTab = tab;
          saveSocialPrefs(prefs);

          d.socialTabBtns.forEach(function (b) {
            b.classList.remove("bg-violet-600", "text-white", "shadow-sm", "active-social-tab");
            b.classList.add("text-slate-400");
          });
          btn.classList.add("bg-violet-600", "text-white", "shadow-sm", "active-social-tab");
          btn.classList.remove("text-slate-400");

          if (d.socialContentFeed) d.socialContentFeed.classList.toggle("hidden", tab !== "feed");
          if (d.socialContentProfile) d.socialContentProfile.classList.toggle("hidden", tab !== "profile");
          if (d.socialContentMessages) d.socialContentMessages.classList.toggle("hidden", tab !== "messages");

          if (tab === "feed") loadActivityFeed();
        });
      });
    }

    // Post activity
    if (d.btnPostActivity) {
      d.btnPostActivity.addEventListener("click", postTextActivity);
    }

    // Search user profile
    if (d.btnSearchUserProfile) {
      d.btnSearchUserProfile.addEventListener("click", function () {
        var username = d.socialUserSearch && d.socialUserSearch.value ? d.socialUserSearch.value.trim() : "";
        if (username) openUserProfile(username);
      });
    }

    // Listen for open-profile events from app.js
    A.bus.on("open-profile", function (payload) {
      var userId = (payload && (payload.userId || payload.name)) || null;
      if (userId) openUserProfile(userId);
    });

    // Listen for list-changed — re-render if lists panel is visible
    A.bus.on("list-changed", function () {
      var d2 = resolveDOM();
      if (d2.listsPanel && !d2.listsPanel.classList.contains("hidden")) {
        renderLists();
      }
    });
  }

  /* ==========================================================================
   * PUBLIC API — exposed on window.Animu.lists
   * ========================================================================== */
  A.lists = {
    // Lists
    loadLists: loadLists,
    bindListEvents: bindListEvents,
    renderLists: renderLists,
    renderStatusTabs: renderStatusTabs,
    quickIncrementProgress: quickIncrementProgress,
    quickEditScore: quickEditScore,
    openListEditor: openListEditor,
    saveListEntry: saveListEntry,
    openMediaDetail: openMediaDetail,
    fetchListEntries: fetchListEntries,

    // Social
    loadSocial: loadSocial,
    bindSocialEvents: bindSocialEvents,
    loadActivityFeed: loadActivityFeed,
    postTextActivity: postTextActivity,
    toggleLikeActivity: toggleLikeActivity,
    toggleReplyActivity: toggleReplyActivity,
    submitReply: submitReply,
    openUserProfile: openUserProfile,
    toggleFollow: toggleFollow,
    toggleFavourite: toggleFavourite,
    sendPrivateMessage: sendPrivateMessage,
  };

  /* ==========================================================================
   * Feature registration
   * ========================================================================== */
  A.registerFeature("lists-social", function initListsSocial() {
    var d = resolveDOM();

    bindListEvents();
    bindSocialEvents();

    // Listen for tab switch events from app.js
    A.bus.on("tab:switch", function (tabName) {
      if (tabName === "lists") {
        loadLists();
      } else if (tabName === "social") {
        loadSocial();
      }
    });

    // Listen for list:loaded to re-render status tabs
    A.bus.on("list:loaded", function () {
      renderStatusTabs();
    });

    A.bus.emit("feature:lists-social:ready", { stub: false });
  });
})();
