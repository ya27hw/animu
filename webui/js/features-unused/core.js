/**
 * core.js — Animu WebUI frontend core module.
 *
 * Establishes the vanilla-JS module contract on `window.Animu`:
 *   - registerFeature(name, init)   Feature registry: deferred plugin init
 *   - settings                     Persistent UI prefs (localStorage layer)
 *   - api                          HTTP helper facade (re-exported from api.js)
 *   - ui                           UI primitives: modal, toast, infinite-scroll
 *   - bus                          Lightweight pub/sub event hub
 *
 * Also provides general-purpose helpers: debounce, throttle, formatRelativeTime.
 *
 * All modules are loaded as plain <script> tags (no build step).  The script
 * execution order is guaranteed by index.html:
 *   core.js -> api.js -> list.js -> downloads.js -> features/*.js -> app.js
 *
 * Designed for vanilla JS — no transpilation, no bundler.
 */
(function () {
  "use strict";

  /* ==========================================================================
   * Pub/Sub Event Bus
   * ========================================================================== */
  const _listeners = {};

  const bus = {
    /**
     * Subscribe to an event. Returns an unsubscribe function.
     * @param {string} event
     * @param {function(*): void} callback
     * @returns {function(): void}
     */
    on(event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
      return function unsubscribe() {
        const idx = _listeners[event].indexOf(callback);
        if (idx !== -1) _listeners[event].splice(idx, 1);
      };
    },

    /**
     * Subscribe to an event, auto-unsubscribing after the first emit.
     * @param {string} event
     * @param {function(*): void} callback
     * @returns {function(): void}
     */
    once(event, callback) {
      const off = bus.on(event, function (payload) {
        off();
        callback(payload);
      });
      return off;
    },

    /**
     * Emit an event to all subscribers.
     * @param {string} event
     * @param {*} [payload]
     */
    emit(event, payload) {
      const subs = _listeners[event];
      if (subs) {
        // Clone so listeners that re-subscribe during emit don't break iteration
        [...subs].forEach((cb) => {
          try {
            cb(payload);
          } catch (e) {
            console.error(`[Animu.bus] listener for "${event}" threw:`, e);
          }
        });
      }
    },

    /** Remove all listeners for a given event (or all events). */
    off(event) {
      if (event) delete _listeners[event];
      else Object.keys(_listeners).forEach((k) => delete _listeners[k]);
    },
  };

  /* ==========================================================================
   * General-purpose helpers
   * ========================================================================== */

  /**
   * Debounce: delay `fn` until it hasn't been called for `wait` ms.
   * @param {function} fn
   * @param {number} wait  milliseconds
   * @returns {function}
   */
  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /**
   * Throttle: ensure `fn` is called at most once per `limit` ms.
   * @param {function} fn
   * @param {number} limit  milliseconds
   * @returns {function}
   */
  function throttle(fn, limit) {
    let inFlight = false;
    let lastArgs = null;
    return function (...args) {
      lastArgs = args;
      if (inFlight) return;
      inFlight = true;
      fn.apply(this, args);
      setTimeout(() => {
        inFlight = false;
        if (lastArgs !== null) {
          const a = lastArgs;
          lastArgs = null;
          fn.apply(this, a);
        }
      }, limit);
    };
  }

  /**
   * Format an ISO/relative date for display.
   * @param {string|number} isoStr
   * @returns {string}
   */
  function formatRelativeTime(isoStr) {
    if (!isoStr) return "Unknown time";
    const date = typeof isoStr === "number" ? new Date(isoStr) : new Date(isoStr);
    if (isNaN(date.getTime())) return isoStr;

    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffHours < 48) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  /* ==========================================================================
   * Settings — persistent UI preferences stored in localStorage
   * ========================================================================== */
  const SETTINGS_KEY = "animu-ui-settings";

  const DEFAULT_SETTINGS = {
    theme: "dark", // "dark" | "light" | "system"
    titleLanguage: "romaji", // "romaji" | "english" | "native"
    // Future prefs can be added here without breaking existing storage
  };

  const settings = {
    _cache: null,

    /** Load settings from localStorage, merging with defaults. */
    load() {
      if (settings._cache) return settings._cache;
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const stored = raw ? JSON.parse(raw) : {};
        settings._cache = { ...DEFAULT_SETTINGS, ...stored };
      } catch (e) {
        console.error("[Animu.settings] parse error, using defaults:", e);
        settings._cache = { ...DEFAULT_SETTINGS };
      }
      return settings._cache;
    },

    /** Persist settings to localStorage. */
    save() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings._cache));
      } catch (e) {
        console.error("[Animu.settings] save error:", e);
      }
    },

    /** Get a setting value. */
    get(key, defaultValue) {
      const s = settings.load();
      return key in s ? s[key] : (defaultValue !== undefined ? defaultValue : undefined);
    },

    /** Set a setting value and persist. */
    set(key, value) {
      const s = settings.load();
      s[key] = value;
      settings._cache = s;
      settings.save();
      // Emit so interested modules can react (e.g. theme toggle)
      bus.emit("setting:changed", { key, value });
      return value;
    },
  };

  /* ==========================================================================
   * UI Primitives
   * ========================================================================== */

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {"success"|"warning"|"error"|"info"} [type]
   * @param {number} [duration=4000]
   */
  function toast(message, type = "success", duration = 4000) {
    const wrapper = document.getElementById("toast-wrapper");
    if (!wrapper) {
      console.warn("[Animu.ui.toast] #toast-wrapper not found");
      return;
    }

    const toastEl = document.createElement("div");
    const typeClasses = {
      success:
        "bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200/50 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300",
      warning:
        "bg-amber-50 dark:bg-amber-950/90 border-amber-200/60 dark:border-amber-900/60 text-amber-800 dark:text-amber-300",
      error:
        "bg-rose-50 dark:bg-rose-950/90 border-rose-200/50 dark:border-rose-900/60 text-rose-800 dark:text-rose-300",
      info:
        "bg-slate-50 dark:bg-slate-950/90 border-slate-200/50 dark:border-slate-900/60 text-slate-800 dark:text-slate-300",
    };
    toastEl.className = `p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm font-semibold pointer-events-auto transform translate-y-4 opacity-0 transition-all duration-300 ${typeClasses[type] || typeClasses.success}`;

    const iconMap = {
      success: "fa-circle-check",
      warning: "fa-triangle-exclamation",
      error: "fa-circle-exclamation",
      info: "fa-circle-info",
    };
    const icon = iconMap[type] || iconMap.success;

    toastEl.innerHTML = `<i class="fa-solid ${icon} text-lg shrink-0"></i><p class="flex-grow">${message}</p>`;
    wrapper.appendChild(toastEl);

    // Slide in
    requestAnimationFrame(() => {
      toastEl.classList.remove("opacity-0", "translate-y-4");
    });

    // Auto-dismiss
    const tid = setTimeout(() => {
      toastEl.classList.add("opacity-0", "translate-y-4");
      toastEl.addEventListener("transitionend", () => toastEl.remove(), { once: true });
    }, duration);

    // Allow manual dismiss on click
    toastEl.style.cursor = "pointer";
    toastEl.addEventListener("click", () => {
      clearTimeout(tid);
      toastEl.classList.add("opacity-0", "translate-y-4");
      toastEl.addEventListener("transitionend", () => toastEl.remove(), { once: true });
    });
  }

  /**
   * Show a modal dialog overlay.
   * @param {HTMLElement} modalEl
   */
  function openModal(modalEl) {
    if (!modalEl) return console.warn("[Animu.ui.openModal] element not found");
    modalEl.classList.remove("opacity-0", "pointer-events-none");
    const child = modalEl.firstElementChild;
    if (child) child.classList.remove("scale-95");
    document.body.style.overflow = "hidden";
  }

  /**
   * Hide a modal dialog overlay.
   * @param {HTMLElement} modalEl
   */
  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add("opacity-0", "pointer-events-none");
    const child = modalEl.firstElementChild;
    if (child) child.classList.add("scale-95");
    document.body.style.overflow = "";
  }

  /**
   * Infinite scroll helper: attaches an IntersectionObserver to a sentinel
   * element that fires `callback` when it enters the viewport.
   *
   * @param {HTMLElement} sentinelEl
   * @param {function(): void} callback
   * @param {object} [opts]
   * @param {number} [opts.rootMargin="200px"]
   * @param {boolean} [opts.once=true]  Auto-unobserve after first trigger.
   * @returns {function(): void}  Unobserve/cleanup function.
   */
  function infiniteScroll(sentinelEl, callback, opts = {}) {
    if (!sentinelEl) return () => {};
    const rootMargin = opts.rootMargin || "200px";
    const once = opts.once !== false; // default true

    let fired = false;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !fired) {
            if (once) fired = true;
            callback();
            if (once) observer.unobserve(sentinelEl);
          }
        });
      },
      { root: null, rootMargin, threshold: 0 }
    );

    observer.observe(sentinelEl);
    return function cleanup() {
      observer.unobserve(sentinelEl);
    };
  }

  const ui = {
    toast,
    openModal,
    closeModal,
    infiniteScroll,
    formatRelativeTime,
  };

  /* ==========================================================================
   * Feature Registry
   * ========================================================================== */

  const _features = {};

  const core = {
    /**
     * Register a feature.  `init` is called immediately if the DOM is
     * ready, or deferred until `DOMContentLoaded`.  Subsequent calls
     * re-register the init function (useful for hot-reload in dev).
     *
     * @param {string} name
     * @param {function(): void} init
     */
    registerFeature(name, init) {
      if (_features[name]) {
        console.warn(`[Animu] Feature "${name}" already registered — overwriting.`);
      }
      _features[name] = init;

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
      } else {
        // Defer slightly so all script tags finish loading
        setTimeout(init, 0);
      }
    },

    /**
     * Retrieve a previously-registered feature init function.
     * @param {string} name
     * @returns {function|undefined}
     */
    getFeature(name) {
      return _features[name];
    },

    /**
     * List all registered feature names.
     * @returns {string[]}
     */
    listFeatures() {
      return Object.keys(_features);
    },
  };

  /* ==========================================================================
   * Expose on window.Animu
   * ========================================================================== */
  window.Animu = {
    registerFeature: core.registerFeature,
    getFeature: core.getFeature,
    listFeatures: core.listFeatures,

    settings: settings,

    api: {}, // populated by api.js (re-exported reference)

    ui: ui,

    bus: bus,

    // Standalone helpers
    debounce: debounce,
    throttle: throttle,
  };

  // Re-emit from api.js registration
  bus.on("api:ready", (apiModule) => {
    window.Animu.api = apiModule;
  });

  // Convenience: emit ready when DOM is loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bus.emit("dom:ready"), { once: true });
  } else {
    bus.emit("dom:ready");
  }
})();
