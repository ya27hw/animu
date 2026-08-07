/**
 * downloads.js — Animu WebUI local scheduler integration module.
 *
 * Exposes:
 *   downloaded_episodes(mediaId) — returns the set of episode numbers already
 *                                  downloaded for a given media, merged from the
 *                                  local /api/anime list (PocketBase cache) and
 *                                  the active qBittorrent download list.
 *   addToWatching(mediaId, payload) — seeds a media entry into the local
 *                                     scheduler: creates an OfflineAnime record,
 *                                     marks it for the next download cycle, and
 *                                     emits a 'scheduler:enqueue' bus event.
 *
 * Emits on window.Animu.bus:
 *   'downloads:loaded'   — { mediaId, episodes: number[] }
 *   'downloads:error'    — { error, context }
 *   'scheduler:enqueue'  — { mediaId, payload }
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.downloads] core.js must be loaded before downloads.js");
  }

  /**
   * Fetch the set of downloaded episode numbers for a given media ID.
   *
   * Merges data from:
   *   - /api/anime (PocketBase OfflineAnime records: downloadedEpisodes array)
   *   - /api/downloads (active qBittorrent torrents — matched by mediaId in filename)
   *
   * @param {number} mediaId  AniList media ID
   * @returns {Promise<number[]>}  Sorted unique list of downloaded episode numbers
   */
  async function downloaded_episodes(mediaId) {
    if (mediaId === undefined || mediaId === null) {
      const err = new Error("downloaded_episodes: mediaId is required");
      A.bus.emit("downloads:error", { error: err, context: "downloaded_episodes" });
      throw err;
    }

    const id = Number(mediaId);
    let episodes = [];

    try {
      // 1. Pull from local /api/anime list (PocketBase cache)
      const animeList = await A.api.getAnimeList();
      const entry = (animeList.anime || []).find((a) => Number(a.mediaId) === id);
      if (entry && Array.isArray(entry.downloadedEpisodes)) {
        episodes = episodes.concat(entry.downloadedEpisodes);
      }
    } catch (e) {
      // Non-fatal: anime list may not be loaded yet
      console.debug("[Animu.downloads] /api/anime fallback skipped:", e.message);
    }

    try {
      // 2. Pull from active qBittorrent downloads
      const downloads = await A.api.getDownloads();
      if (downloads && Array.isArray(downloads)) {
        downloads.forEach((dl) => {
          // Match torrents whose name contains the mediaId or the anime title
          const name = (dl.name || "").toLowerCase();
          const matched =
            name.includes(`[animu-${id}]`) ||
            name.includes(`[anitoki-${id}]`) ||
            name.includes(`-${id}-`) ||
            (entry && name.includes(entry.media?.title?.romaji?.toLowerCase()));

          if (matched && dl.episodes) {
            // dl.episodes may be a comma-separated string or array
            const eps = Array.isArray(dl.episodes)
              ? dl.episodes
              : String(dl.episodes)
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map((s) => parseInt(s, 10));
            episodes = episodes.concat(eps.filter((n) => !isNaN(n)));
          }
        });
      }
    } catch (e) {
      console.debug("[Animu.downloads] /api/downloads fallback skipped:", e.message);
    }

    // Deduplicate + sort numerically
    const unique = [...new Set(episodes)].filter((n) => !isNaN(n)).sort((a, b) => a - b);
    A.bus.emit("downloads:loaded", { mediaId: id, episodes: unique });
    return unique;
  }

  /**
   * Add a media entry to the local download scheduler.
   *
   * This performs the "Add to Watching" flow:
   *   1. Fetch /api/anime to check for an existing OfflineAnime record
   *   2. PATCH /api/anime/:id to set startingEpisode / override title
   *   3. Emit 'scheduler:enqueue' so the scheduler picks it up on next cycle
   *
   * @param {number} mediaId  AniList media ID
   * @param {object} [payload]
   * @param {string} [payload.altTitle]     Override title for Nyaa searches
   * @param {number} [payload.startEp=1]    Starting episode offset
   * @param {string} [payload.resolution]  Target resolution (1080p, 720p, etc.)
   * @returns {Promise<object>}  { ok, mediaId, enqueued }
   */
  async function addToWatching(mediaId, payload = {}) {
    if (mediaId === undefined || mediaId === null) {
      const err = new Error("addToWatching: mediaId is required");
      A.bus.emit("downloads:error", { error: err, context: "addToWatching" });
      throw err;
    }

    const id = Number(mediaId);
    const opts = {
      altTitle: payload.altTitle || "",
      startEp: payload.startEp !== undefined ? payload.startEp : 0,
      resolution: payload.resolution || "",
    };

    try {
      // 1. Attempt to upsert the local record via PATCH
      // The backend PATCH /api/anime/:id handles the OfflineAnime upsert
      const patchPayload = {};
      if (opts.altTitle) patchPayload.alternativeTitle = opts.altTitle;
      if (opts.startEp) patchPayload.startingEpisode = opts.startEp;
      if (opts.resolution) patchPayload.targetResolution = opts.resolution;

      await A.api._request(`/api/anime/${id}`, {
        method: "PATCH",
        body: patchPayload,
      });

      A.bus.emit("scheduler:enqueue", {
        mediaId: id,
        payload: opts,
      });

      A.ui.toast(`Added media ${id} to watching scheduler.`, "success");
      return { ok: true, mediaId: id, enqueued: true };
    } catch (err) {
      // If PATCH fails (e.g. backend offline), still emit enqueue so the
      // scheduler queue logic can be tested / inspected
      A.bus.emit("scheduler:enqueue", {
        mediaId: id,
        payload: opts,
      });

      A.bus.emit("downloads:error", { error: err, context: "addToWatching" });
      A.ui.toast(
        `Added media ${id} to scheduler (local only — backend sync failed: ${err.message})`,
        "warning"
      );
      return { ok: false, mediaId: id, enqueued: true, error: err.message };
    }
  }

  // ---- Module registration ----
  A.downloads = {
    downloaded_episodes,
    addToWatching,
  };

  A.bus.emit("downloads:ready", A.downloads);
})();
