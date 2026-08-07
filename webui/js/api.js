/**
 * api.js — Animu WebUI API client.
 *
 * A thin fetch wrapper around the backend `/api/*` endpoints defined in
 * animu/web.py.  All methods return JSON promises and never throw into
 * the caller for HTTP errors — instead they reject with a descriptive
 * `Error` whose `status` property carries the HTTP code.
 *
 * The module auto-registers itself on `window.Animu.api` and emits an
 * `api:ready` event so that consumers can safely reference it after
 * the script has loaded.
 */
(function () {
  "use strict";

  const BASE = ""; // Same-origin — relative paths resolve against the current page

  /**
   * Internal helper: perform a fetch and return parsed JSON.
   * Rejects with Error(status, statusText) on non-OK responses.
   *
   * @param {string} path  e.g. "/api/anilist/discover"
   * @param {object} [opts]  fetch options (method, headers, body)
   * @returns {Promise<any>}
   */
  async function _request(path, opts = {}) {
    const options = {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    };
    if (options.body && typeof options.body === "object") {
      options.body = JSON.stringify(options.body);
    }

    const resp = await fetch(path, options);
    let data;
    try {
      data = await resp.json();
    } catch (_e) {
      data = { raw: await resp.text() };
    }

    if (!resp.ok) {
      const err = new Error(data.error || data.message || resp.statusText || "Request failed");
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ==========================================================================
   * AniList REST wrappers (mirror animu/web.py routes)
   * ========================================================================== */

  const api = {
    // ---- Auth ----
    /** GET /api/anilist/auth/state — auth status without exposing token */
    async getAuthState() {
      return _request("/api/anilist/auth/state");
    },

    /** GET /api/anilist/auth/url?grant=code|token&redirect_uri=… */
    async getAuthUrl(grant = "code", redirectUri) {
      const params = new URLSearchParams({ grant });
      if (redirectUri) params.set("redirect_uri", redirectUri);
      return _request(`/api/anilist/auth/url?${params}`);
    },

    /** GET /api/anilist/auth/pin — PIN-flow auth URL */
    async getAuthPinUrl() {
      return _request("/api/anilist/auth/pin");
    },

    /** POST /api/anilist/auth/callback — exchange code for token */
    async exchangeAuthCode(code, redirectUri) {
      return _request("/api/anilist/auth/callback", {
        method: "POST",
        body: { code, redirect_uri: redirectUri || undefined },
      });
    },

    /** POST /api/anilist/auth/clear — clears stored token */
    async clearAuth() {
      return _request("/api/anilist/auth/clear", { method: "POST" });
    },

    // ---- Discover ----
    /** GET /api/anilist/discover?type=trending|popular|top&page=N&perPage=N */
    async getDiscover(type = "trending", page = 1, perPage = 20) {
      return _request(`/api/anilist/discover?type=${encodeURIComponent(type)}&page=${page}&perPage=${perPage}`);
    },

    // ---- Search ----
    /** GET /api/anilist/search?q=…&type=anime&page=N&perPage=N */
    async search(query, opts = {}) {
      const params = new URLSearchParams({ q: query, page: String(opts.page || 1) });
      if (opts.type) params.set("type", opts.type);
      if (opts.perPage) params.set("perPage", String(opts.perPage));
      return _request(`/api/anilist/search?${params}`);
    },

    // ---- Media ----
    /** GET /api/anilist/media/:id */
    async getMedia(mediaId) {
      return _request(`/api/anilist/media/${mediaId}`);
    },

    /** GET /api/anilist/media/:id/airing */
    async getAiring(mediaId) {
      return _request(`/api/anilist/media/${mediaId}/airing`);
    },

    /** GET /api/anilist/media/:id/relations */
    async getRelations(mediaId) {
      return _request(`/api/anilist/media/${mediaId}/relations`);
    },

    // ---- Media Trend ----
    /** GET /api/anilist/media-trend?mediaId=N&type=…&days=N */
    async getMediaTrend(mediaId, type = "trending", days = 30) {
      const params = new URLSearchParams({ mediaId: String(mediaId), type, days: String(days) });
      return _request(`/api/anilist/media-trend?${params}`);
    },

    // ---- User ----
    /** GET /api/anilist/viewer — convenience alias for authenticated user */
    async getViewer() {
      return _request("/api/anilist/viewer");
    },

    /** GET /api/anilist/user/:id or /api/anilist/user */
    async getUser(userId = "") {
      return _request(`/api/anilist/user/${userId}`.replace(/\/$/,""));
    },

    /** GET /api/anilist/user/:id/following */
    async getUserFollowing(userId) {
      return _request(`/api/anilist/user/${userId}/following`);
    },

    /** GET /api/anilist/user/:id/followers */
    async getUserFollowers(userId) {
      return _request(`/api/anilist/user/${userId}/followers`);
    },

    // ---- Lists ----
    /** GET /api/anilist/user-list?type=anime|manga&status=... */
    async getUserList(opts = {}) {
      const params = new URLSearchParams();
      if (opts.type) params.set("type", opts.type);
      if (opts.status) params.set("status", opts.status);
      if (opts.page) params.set("page", String(opts.page));
      const qs = params.toString();
      return _request(`/api/anilist/user-list${qs ? `?${qs}` : ""}`);
    },

    /** POST /api/anilist/list — save a media list entry (requires auth) */
    async saveListEntry(mediaId, payload) {
      return _request("/api/anilist/list", {
        method: "POST",
        body: { mediaId, ...payload },
      });
    },

    /** POST /api/anilist/list/update — full SaveMediaListEntry (requires auth) */
    async updateListEntry(mediaId, payload) {
      return _request("/api/anilist/list/update", {
        method: "POST",
        body: { mediaId, ...payload },
      });
    },

    /** POST /api/anilist/list/update-many — bulk update (requires auth) */
    async updateListEntriesMany(entries) {
      return _request("/api/anilist/list/update-many", {
        method: "POST",
        body: { entries },
      });
    },

    /** DELETE /api/anilist/list/:id — delete an entry (requires auth) */
    async deleteListEntry(entryId) {
      return _request(`/api/anilist/list/${entryId}`, { method: "DELETE" });
    },

    // ---- Collections ----
    /** GET /api/anilist/list/collection */
    async getCustomLists() {
      return _request("/api/anilist/list/collection");
    },

    /** POST /api/anilist/list/custom */
    async manageCustomList(name, action) {
      return _request("/api/anilist/list/custom", {
        method: "POST",
        body: { name, action },
      });
    },

    // ---- Genres & Tags ----
    /** GET /api/anilist/genres */
    async getGenres() {
      return _request("/api/anilist/genres");
    },

    /** GET /api/anilist/tags */
    async getTags() {
      return _request("/api/anilist/tags");
    },

    // ---- Characters, Staff, Studios ----
    /** GET /api/anilist/character/:id */
    async getCharacter(charId) {
      return _request(`/api/anilist/character/${charId}`);
    },

    /** GET /api/anilist/staff/:id */
    async getStaff(staffId) {
      return _request(`/api/anilist/staff/${staffId}`);
    },

    /** GET /api/anilist/studio/:id */
    async getStudio(studioId) {
      return _request(`/api/anilist/studio/${studioId}`);
    },

    // ---- Social ----
    /** GET /api/anilist/activity?userId=N&type=following */
    async getActivity(opts = {}) {
      const params = new URLSearchParams();
      if (opts.userId) params.set("userId", String(opts.userId));
      if (opts.type) params.set("type", opts.type);
      if (opts.page) params.set("page", String(opts.page));
      const qs = params.toString();
      return _request(`/api/anilist/activity${qs ? `?${qs}` : ""}`);
    },

    /**
     * POST /api/anilist/activity/text — post a text activity (requires auth)
     * @param {string} text
     * @param {string} [type]  "anime" | "manga" | "text"
     * @param {number} [mediaId]
     */
    async postTextActivity(text, type, mediaId) {
      return _request("/api/anilist/activity/text", {
        method: "POST",
        body: { text, type, mediaId },
      });
    },

    /** POST /api/anilist/activity/message — send a private message (requires auth) */
    async sendMessageActivity(recipientId, text) {
      return _request("/api/anilist/activity/message", {
        method: "POST",
        body: { recipientId, text },
      });
    },

    /** POST /api/anilist/activity/reply — reply to an activity (requires auth) */
    async replyActivity(activityId, text) {
      return _request("/api/anilist/activity/reply", {
        method: "POST",
        body: { activityId, text },
      });
    },

    /** POST /api/anilist/like — toggle like (requires auth) */
    async toggleLike(id, type) {
      return _request("/api/anilist/like", {
        method: "POST",
        body: { id, type },
      });
    },

    /** POST /api/anilist/follow — toggle follow (requires auth) */
    async toggleFollow(userId) {
      return _request("/api/anilist/follow", {
        method: "POST",
        body: { userId },
      });
    },

    /** POST /api/anilist/favourite — toggle favourite (requires auth) */
    async toggleFavourite(id, type) {
      return _request("/api/anilist/favourite", {
        method: "POST",
        body: { id, type },
      });
    },

    // ---- Reviews & Recommendations ----
    /** GET /api/anilist/reviews?mediaId=N */
    async getReviews(mediaId) {
      return _request(`/api/anilist/reviews?mediaId=${mediaId}`);
    },

    /** POST /api/anilist/review — save a review (requires auth) */
    async saveReview(mediaId, summary, body, score) {
      return _request("/api/anilist/review", {
        method: "POST",
        body: { mediaId, summary, body, score },
      });
    },

    /** POST /api/anilist/review/rate — rate a review (requires auth) */
    async rateReview(reviewId, rating) {
      return _request("/api/anilist/review/rate", {
        method: "POST",
        body: { reviewId, rating },
      });
    },

    /** GET /api/anilist/recommendations?mediaId=N */
    async getRecommendations(mediaId) {
      return _request(`/api/anilist/recommendations?mediaId=${mediaId}`);
    },

    // ---- Notifications & Stats ----
    /** GET /api/anilist/notifications */
    async getNotifications() {
      return _request("/api/anilist/notifications");
    },

    /** GET /api/anilist/site-statistics */
    async getSiteStatistics() {
      return _request("/api/anilist/site-statistics");
    },

    // ---- AniChart ----
    /** GET /api/anilist/anichart/:userId */
    async getAniChartHighlights(userId) {
      return _request(`/api/anilist/anichart/${userId}`);
    },

    // ---- Markdown ----
    /** GET /api/anilist/markdown?text=... */
    async renderMarkdown(text) {
      return _request(`/api/anilist/markdown?${new URLSearchParams({ text })}`);
    },

    // ---- Threads ----
    /** GET /api/anilist/thread/:id */
    async getThread(threadId) {
      return _request(`/api/anilist/thread/${threadId}`);
    },

    /** GET /api/anilist/threads?mediaId=N */
    async getThreads(mediaId) {
      const qs = mediaId ? `?mediaId=${mediaId}` : "";
      return _request(`/api/anilist/threads${qs}`);
    },

    /** POST /api/anilist/thread/:id/comments — list thread comments */
    async getThreadComments(threadId) {
      return _request(`/api/anilist/thread/${threadId}/comments`, { method: "POST" });
    },

    // ---- Local / non-AniList ----
    /** GET /api/anime — local watchlist (AniList + PocketBase merge) */
    async getAnimeList() {
      return _request("/api/anime");
    },

    /** GET /api/config — sanitized config */
    async getConfig() {
      return _request("/api/config");
    },

    /** PATCH /api/config — save config */
    async saveConfig(payload) {
      return _request("/api/config", { method: "PATCH", body: payload });
    },

    /** GET /api/downloads — active qBittorrent downloads */
    async getDownloads() {
      return _request("/api/downloads");
    },

    /** GET /api/history — download history */
    async getHistory() {
      return _request("/api/history");
    },

    /** GET /api/ignored — ignored titles */
    async getIgnored() {
      return _request("/api/ignored");
    },

    /** POST /api/ignored */
    async addIgnored(title, mediaId) {
      return _request("/api/ignored", {
        method: "POST",
        body: { title, mediaId },
      });
    },

    /** DELETE /api/ignored/:idOrTitle */
    async deleteIgnored(idOrTitle) {
      return _request(`/api/ignored/${encodeURIComponent(idOrTitle)}`, { method: "DELETE" });
    },

    /** GET /api/logs?name=…&lines=N */
    async getLogs(name, lines) {
      return _request(`/api/logs?name=${encodeURIComponent(name || "combined")}&lines=${lines || 250}`);
    },

    /** GET /api/health */
    async getHealth() {
      return _request("/api/health");
    },

    // ---- Internal raw request (for ad-hoc paths not yet wrapped) ----
    // Exposed so modules like downloads.js can call PATCH /api/anime/:id etc.
    _request,
  };

  // ---- Register on window.Animu and notify subscribers ----
  if (typeof window !== "undefined") {
    window.Animu = window.Animu || {};
    window.Animu.api = api;
    window.Animu.bus.emit("api:ready", api);
  }

  // Export for module-aware environments (not used in vanilla script-tag mode)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
