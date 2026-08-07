/**
 * lists-social.js — AniList Lists + Social feature (T3 scaffold stub).
 *
 * No-op stub. The full implementation (5 statuses, progress/score editing,
 * custom lists, bulk actions, activity feed, follow, favorites, PMs) will be
 * built by a later feature task. This stub registers on window.Animu.list
 * to ensure the module is loaded.
 *
 * Note: The list data logic (fetchList, updateListEntry, list-changed) lives
 * in the separate list.js module which is already functional. This feature
 * stub is the rendering/UI layer that will be implemented later.
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.lists-social] core.js must be loaded before lists-social.js");
  }

  A.registerFeature("lists-social", function initListsSocial() {
    // Ensure list.js has registered its functions
    if (A.list && A.list.fetchList) {
      A.bus.emit("feature:lists-social:ready", { stub: true });
    } else {
      A.bus.once("list:ready", () => {
        A.bus.emit("feature:lists-social:ready", { stub: true });
      });
    }
  });
})();
