/**
 * list.js — Animu WebUI AniList list module.
 *
 * Exposes:
 *   fetchList(opts)          — fetch the user's MediaListCollection (watching/
 *                              planning/completed/paused/dropped) via /api/anilist/user-list
 *   updateListEntry(mediaId, payload) — SANDBOX ONLY: updates local state + emits
 *                              'list-changed' bus event.  Does NOT call the backend
 *                              mutation — that is the job of api.js / app.js in the
 *                              full implementation.  The sandbox stub exists so the
 *                              Settings → Lists integration can be built incrementally
 *                              without production AniList writes during T3 scaffolding.
 *
 * Emits on window.Animu.bus:
 *   'list-changed'  — { action, mediaId, payload, entry }  fired after updateListEntry
 *   'list:loaded'   — { count, entries }  fired after fetchList resolves
 *   'list:error'    — { error, context }   fired when any list operation fails
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.list] core.js must be loaded before list.js");
  }

  /**
   * Fetch the user's full anime/manga list collection.
   *
   * @param {object} [opts]
   * @param {("anime"|"manga")} [opts.type="anime"]
   * @param {string} [opts.status]  One of the 5 statuses, or undefined for all.
   * @param {number} [opts.page=1]
   * @returns {Promise<object>}  The parsed JSON response from /api/anilist/user-list
   */
  async function fetchList(opts = {}) {
    const type = opts.type || "anime";
    const status = opts.status;
    const page = opts.page || 1;

    try {
      const data = await A.api.getUserList({ type, status, page });
      const entries = _extractEntries(data, type);
      A.bus.emit("list:loaded", { count: entries.length, entries, raw: data });
      return data;
    } catch (err) {
      A.bus.emit("list:error", { error: err, context: "fetchList" });
      A.ui.toast(err.message || "Failed to load list", "error");
      throw err;
    }
  }

  /**
   * Extract a flat array of media entries from the API response.
   * The response shape depends on whether it's a user list or a collection.
   *
   * @param {object} data
   * @param {string} type
   * @returns {Array}
   */
  function _extractEntries(data, type) {
    if (!data) return [];
    // The /api/anilist/user-list route returns { lists: [{ status, entries: [...] }] }
    if (data.lists && Array.isArray(data.lists)) {
      return data.lists.flatMap((list) => list.entries || []);
    }
    // Fallback: might return an array directly
    if (Array.isArray(data)) return data;
    return [];
  }

  /**
   * SANDBOX ONLY — does NOT perform a real AniList mutation.
   *
   * This stub updates the in-memory `window.Animu._listCache` (if present)
   * and emits a 'list-changed' event so that UI components listening on
   * the bus can re-render optimistically.  The actual backend mutation
   * should be invoked via `window.Animu.api.updateListEntry(mediaId, payload)`
   * in the real implementation.
   *
   * @param {number} mediaId  AniList media ID
   * @param {object} payload  Partial list-entry fields (status, progress, score, etc.)
   * @returns {object}  { ok, mediaId, payload, entry }
   */
  function updateListEntry(mediaId, payload) {
    // Validate inputs
    if (mediaId === undefined || mediaId === null) {
      const err = new Error("updateListEntry: mediaId is required");
      A.bus.emit("list:error", { error: err, context: "updateListEntry" });
      A.ui.toast(err.message, "error");
      throw err;
    }

    const entry = {
      mediaId: Number(mediaId),
      ...payload,
      _updatedAt: Date.now(),
      _sandbox: true, // flag so consumers know this is local-only
    };

    // Update in-memory cache if it exists
    if (A._listCache && Array.isArray(A._listCache)) {
      const idx = A._listCache.findIndex((e) => Number(e.mediaId) === Number(mediaId));
      if (idx !== -1) {
        A._listCache[idx] = { ...A._listCache[idx], ...entry };
      } else {
        A._listCache.push(entry);
      }
    }

    // Emit bus event so subscribed UI modules can react
    A.bus.emit("list-changed", {
      action: "update",
      mediaId: Number(mediaId),
      payload,
      entry,
    });

    A.ui.toast(
      `Updated "${mediaId}" locally (sandbox — backend mutation not called)`,
      "info"
    );

    return { ok: true, mediaId, payload, entry };
  }

  // ---- Module registration ----
  // list.js is a passive module — it doesn't auto-initialize DOM on load.
  // Feature modules (lists-social.js, home.js) will call these exports.

  // Expose on window.Animu.list so features can access the functions
  A.list = {
    fetchList,
    updateListEntry,
  };

  // Also emit ready so any waiting subscribers can bind
  A.bus.emit("list:ready", A.list);
})();
