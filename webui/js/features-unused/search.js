/**
 * search.js — AniList global search feature (T3 scaffold stub).
 *
 * No-op stub. The full implementation (debounced search-as-you-type,
 * entity-type tabs, filter drawer, infinite scroll) will be built by a
 * later feature task. This stub registers the module contract so
 * index.html's <script> tag never breaks.
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.search] core.js must be loaded before search.js");
  }

  A.registerFeature("search", function initSearch() {
    // No-op: search UI remains in app.js (preserved from T2).
    // Future: wire debounced input to A.api.search() + A.ui.infiniteScroll()
    A.bus.emit("feature:search:ready", { stub: true });
  });
})();
