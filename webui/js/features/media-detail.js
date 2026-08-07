/**
 * media-detail.js — AniList media detail panel feature (T3 scaffold stub).
 *
 * No-op stub. The full implementation (hero image, titles, synopsis,
 * data block, tag cloud, characters/VAs, staff, relations, recommendations,
 * reviews, distributions, trailer, streaming links, list editor modal)
 * will be built by a later feature task.
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.media-detail] core.js must be loaded before media-detail.js");
  }

  A.registerFeature("media-detail", function initMediaDetail() {
    // No-op: media detail UI remains in app.js (preserved from T2).
    // Future: render detailContentContainer using A.api.getMedia()
    A.bus.emit("feature:media-detail:ready", { stub: true });
  });
})();
