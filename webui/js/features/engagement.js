/**
 * engagement.js — AniList engagement feature (notifications, stats, reviews).
 *
 * No-op stub. The full implementation (airing notifications via polling,
 * stats/analytics charts, review rating) will be built by a later feature
 * task. This stub registers the module contract so index.html's <script>
 * tag never breaks.
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.engagement] core.js must be loaded before engagement.js");
  }

  A.registerFeature("engagement", function initEngagement() {
    // No-op: notifications/stats features are future scope.
    // Future: poll A.api.getNotifications(), render charts from A.api.getSiteStatistic()
    A.bus.emit("feature:engagement:ready", { stub: true });
  });
})();
