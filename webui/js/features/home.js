/**
 * home.js — AniList Discover/Home feature (T3 scaffold stub).
 *
 * This is a no-op stub. The full implementation (trending/popular/upcoming/
 * top-100 rails, seasonal chart grid, media-trend sparklines) will be
 * implemented by a later feature task. Until then this module registers
 * itself so that the module contract on window.Animu is satisfied and
 * index.html's <script> tag never breaks.
 *
 * The stub:
 *   - Registers the "home" feature on window.Animu
 *   - Emits 'feature:home:ready' so future modules can await it
 *   - Does nothing destructive — no network calls, no DOM mutations
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.home] core.js must be loaded before home.js");
  }

  A.registerFeature("home", function initHome() {
    // No-op: Discover tab UI is still driven by app.js (preserved from T2).
    // Future: replace the app.js-driven discover feed with this module's
    // fetchList / rail logic and bus-bound rendering.
    A.bus.emit("feature:home:ready", { stub: true });
  });
})();
