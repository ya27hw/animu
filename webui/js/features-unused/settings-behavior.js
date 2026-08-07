/**
 * settings-behavior.js — T3 Settings UI behavior.
 *
 * Implements the Settings-panel behavior for the T3 frontend scaffold:
 *   - OAuth login state: checks /api/anilist/auth/state on Settings tab open
 *     and reflects connected/disconnected status in the UI.
 *   - Token-expiry warning: displays a warning when the token is near expiry
 *     (daysRemaining <= 30) or shows an "ok" banner when still valid.
 *   - Class-based dark theme toggle: persists selection (light/dark/system)
 *     to localStorage and toggles the `dark` class on <html>. Replaces the
 *     existing simple moon/sun toggle with a proper 3-way selector.
 *   - Title-language preference: persists romaji/english/native to settings.
 *
 * All prefs are stored via window.Animu.settings (localStorage-backed).
 * Listens on window.Animu.bus for 'tab:switch' events to refresh auth state.
 */
(function () {
  "use strict";

  const A = window.Animu;
  if (!A) {
    throw new Error("[Animu.settings-behavior] core.js must be loaded before settings-behavior.js");
  }

  // ---- DOM element references (resolved lazily via registerFeature) ----
  let _dom = null;

  function resolveDOM() {
    if (_dom) return _dom;
    _dom = {
      // OAuth auth state
      authStatusIndicator: document.getElementById("auth-status-indicator"),
      authStatusText: document.getElementById("auth-status-text"),
      btnOAuth: document.getElementById("btn-anilist-oauth"),
      tokenExpiryWarning: document.getElementById("token-expiry-warning"),
      tokenExpiryText: document.getElementById("token-expiry-text"),
      tokenExpiryOk: document.getElementById("token-expiry-ok"),

      // Theme toggle
      btnThemeLight: document.getElementById("btn-theme-light"),
      btnThemeDark: document.getElementById("btn-theme-dark"),
      btnThemeSystem: document.getElementById("btn-theme-system"),

      // Title language
      titleLanguageSelect: document.getElementById("title-language-select"),
    };
    return _dom;
  }

  // ---- Theme management ----

  /**
   * Apply the class-based dark theme based on the stored preference.
   * @param {string} theme  "light" | "dark" | "system"
   */
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === "system") {
      // Use CSS prefers-color-scheme media query
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    } else if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }

  /**
   * Bind theme toggle buttons. Uses class-based dark mode (adds/removes
   * the `dark` class on <html>), replacing the old simple moon/sun toggle.
   */
  function bindThemeToggle() {
    const d = resolveDOM();
    const savedTheme = A.settings.get("theme", "dark");

    applyTheme(savedTheme);

    // Sync button active states
    function updateActive(btn) {
      [d.btnThemeLight, d.btnThemeDark, d.btnThemeSystem].forEach((b) => {
        if (!b) return;
        b.classList.remove("ring-2", "ring-violet-500");
      });
      if (btn) btn.classList.add("ring-2", "ring-violet-500");
    }
    const activeMap = { light: d.btnThemeLight, dark: d.btnThemeDark, system: d.btnThemeSystem };
    updateActive(activeMap[savedTheme]);

    [d.btnThemeLight, d.btnThemeDark, d.btnThemeSystem].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        const theme = btn.dataset.theme;
        A.settings.set("theme", theme);
        applyTheme(theme);
        updateActive(btn);
        A.ui.toast(`Theme set to ${theme}.`, "info");
      });
    });

    // Listen for system preference changes when in "system" mode
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (A.settings.get("theme") === "system") {
        applyTheme("system");
      }
    });
  }

  // ---- Title language preference ----

  function syncTitleLanguage(lang) {
    // Persist to settings
    A.settings.set("titleLanguage", lang);
    A.bus.emit("setting:titleLanguage", lang);

    // Sync with app.js's active discover state if available
    if (window.UI && typeof window.UI.setTitleLang === "function") {
      window.UI.setTitleLang(lang);
    }
  }

  function bindTitleLanguage() {
    const d = resolveDOM();
    const saved = A.settings.get("titleLanguage", "romaji");

    if (d.titleLanguageSelect) {
      d.titleLanguageSelect.value = saved;
      d.titleLanguageSelect.addEventListener("change", () => {
        const lang = d.titleLanguageSelect.value;
        syncTitleLanguage(lang);
        A.ui.toast(
          `Title language set to ${d.titleLanguageSelect.options[d.titleLanguageSelect.selectedIndex].text}.`,
          "info"
        );
      });
    }
  }

  // ---- OAuth login state ----

  /**
   * Check auth state from the backend and update the UI.
   * Never exposes the token value — only the auth state endpoint is used.
   */
  async function checkAuthState() {
    const d = resolveDOM();
    if (!d.authStatusIndicator) return; // Settings panel not in DOM

    try {
      const state = await A.api.getAuthState();
      const present = state.present || state.authenticated;
      const needsReauth = state.needsReauth;
      const expiry = state.tokenExpiry || {};

      if (!present || !state.authenticated) {
        // Not connected
        d.authStatusIndicator.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
        d.authStatusText.textContent = "Not connected to AniList";
        d.tokenExpiryWarning.classList.add("hidden");
        d.tokenExpiryOk.classList.add("hidden");
        if (d.btnOAuth) {
          d.btnOAuth.innerHTML = '<i class="fa-solid fa-right-to-bracket text-[10px]"></i>Connect';
        }
        return;
      }

      // Connected
      d.authStatusIndicator.className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
      d.authStatusText.textContent = `Connected as ${state.userName || "user"}`;

      if (d.btnOAuth) {
        d.btnOAuth.innerHTML = '<i class="fa-solid fa-right-to-bracket text-[10px]"></i>Reconnect';
      }

      // Token expiry warning
      if (needsReauth) {
        d.tokenExpiryWarning.classList.remove("hidden");
        d.tokenExpiryOk.classList.add("hidden");
        d.tokenExpiryText.textContent = "Token expired — re-authentication required.";
      } else if (expiry.daysRemaining !== undefined && expiry.daysRemaining <= 30) {
        d.tokenExpiryWarning.classList.remove("hidden");
        d.tokenExpiryOk.classList.add("hidden");
        d.tokenExpiryText.textContent = `Token expires in ${expiry.daysRemaining} day(s). Re-authenticate soon.`;
      } else {
        d.tokenExpiryWarning.classList.add("hidden");
        d.tokenExpiryOk.classList.remove("hidden");
      }
    } catch (err) {
      // Backend offline — show disconnected
      d.authStatusIndicator.className = "w-2.5 h-2.5 rounded-full bg-rose-500";
      d.authStatusText.textContent = "Unable to check AniList auth status";
      d.tokenExpiryWarning.classList.add("hidden");
      d.tokenExpiryOk.classList.add("hidden");
    }
  }

  /**
   * Handle the OAuth Connect button:
   * - Fetches /api/anilist/auth/url with grant=token (implicit flow for SPA)
   * - Opens the auth URL in a popup (or new tab)
   * - Listens for the callback via window.postMessage
   */
  async function handleOAuthConnect() {
    try {
      const res = await A.api.getAuthUrl("token");
      const url = res.authUrl;
      if (!url) {
        A.ui.toast("Could not generate AniList auth URL.", "error");
        return;
      }

      // Open popup for the OAuth flow
      const popup = window.open(
        url,
        "anilist-oauth",
        "width=600,height=700,scrollbars=yes,resizable=yes"
      );

      if (!popup) {
        A.ui.toast("Popup blocked — opening in new tab instead.", "warning");
        window.open(url, "_blank");
        return;
      }

      // Listen for the callback (the backend redirect handler posts back)
      function onMessage(event) {
        // Verify origin for security
        if (event.origin !== window.location.origin) return;

        if (event.data && event.data.type === "anilist-auth-complete") {
          window.removeEventListener("message", onMessage);
          if (event.data.ok) {
            A.ui.toast("AniList authentication successful!", "success");
            checkAuthState();
          } else {
            A.ui.toast(`Auth failed: ${event.data.error || "Unknown error"}`, "error");
          }
        }
      }

      window.addEventListener("message", onMessage);

      // Cleanup timer if popup is closed manually
      const checker = setInterval(() => {
        if (popup.closed) {
          clearInterval(checker);
          window.removeEventListener("message", onMessage);
        }
      }, 1000);
    } catch (err) {
      A.ui.toast(`Auth error: ${err.message}`, "error");
    }
  }

  /**
   * Expose clearAuth for a "Disconnect" action (future use).
   */
  async function handleClearAuth() {
    try {
      await A.api.clearAuth();
      A.ui.toast("AniList session cleared.", "success");
      checkAuthState();
    } catch (err) {
      A.ui.toast(`Clear auth failed: ${err.message}`, "error");
    }
  }

  // ---- Feature registration ----

  A.registerFeature("settings-behavior", function initSettingsBehavior() {
    // Bind theme toggle (class-based dark mode)
    bindThemeToggle();

    // Bind title language preference
    bindTitleLanguage();

    // Bind OAuth connect button
    const d = resolveDOM();
    if (d.btnOAuth) {
      d.btnOAuth.addEventListener("click", handleOAuthConnect);
    }

    // Listen for tab switches to refresh auth state
    A.bus.on("tab:switch", (tabName) => {
      if (tabName === "settings") {
        checkAuthState();
      }
    });

    // Also check on initial load if settings tab is visible
    const settingsPanel = document.getElementById("settings-panel");
    if (settingsPanel && !settingsPanel.classList.contains("hidden")) {
      checkAuthState();
    }

    A.bus.emit("feature:settings-behavior:ready", { stub: false });
  });

  // Expose for other modules
  A.settingsBehavior = {
    checkAuthState,
    applyTheme,
    handleOAuthConnect,
    handleClearAuth,
  };
})();
