import unittest
import os
import threading
import http.server
from animu.web import AnimuHTTPHandler
from playwright.sync_api import sync_playwright


class TestMobileNavigation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.index_path = os.path.join(cls.base_dir, "webui", "index.html")
        cls.app_js_path = os.path.join(cls.base_dir, "webui", "app.js")

        # Start local test HTTP server to serve real index.html and app.js
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), AnimuHTTPHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

        # Launch real headless browser with mobile viewport
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "browser"):
            cls.browser.close()
        if hasattr(cls, "pw"):
            cls.pw.stop()
        if hasattr(cls, "server"):
            cls.server.shutdown()
            cls.server.server_close()

    def _create_mobile_page(self):
        page = self.browser.new_page(viewport={"width": 375, "height": 667})
        page.goto(f"http://127.0.0.1:{self.port}/")
        page.wait_for_load_state("domcontentloaded")
        return page

    def _get_drawer_state(self, page):
        return page.evaluate("""() => {
            const menu = document.getElementById('mobile-menu');
            const btn = document.getElementById('hamburger-btn');
            const icon = btn ? btn.querySelector('i') : null;
            return {
                isOpen: menu ? menu.classList.contains('mobile-open') : false,
                icon: icon ? icon.className : '',
                ariaLabel: btn ? btn.getAttribute('aria-label') : '',
                maxHeight: menu ? menu.style.maxHeight : ''
            };
        }""")

    def test_mobile_tab_elements_exist_in_html(self):
        """Verify HTML contains mobile nav tabs for watching, discover, logs, and settings."""
        with open(self.index_path, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn('data-tab="watching"', html)
        self.assertIn('data-tab="discover"', html)
        self.assertIn('data-tab="logs"', html)
        self.assertIn('data-tab="settings"', html)
        self.assertIn('mobile-nav-tab', html)
        self.assertIn('id="mobile-menu"', html)

    def test_html_hamburger_initial_state(self):
        """Verify initial hamburger button structure, aria-label, and icon."""
        with open(self.index_path, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn('id="hamburger-btn"', html)
        self.assertIn('aria-label="Open menu"', html)
        self.assertIn('fa-bars', html)
        self.assertIn('id="mobile-menu"', html)
        self.assertIn('max-h-0', html)

    def test_app_js_binds_mobile_tabs(self):
        """Verify real app.js binds mobile tabs to switch active view panels."""
        page = self._create_mobile_page()
        try:
            # 1. Open mobile drawer and switch to logs tab
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            page.locator('.mobile-nav-tab[data-tab="logs"]').click()
            page.wait_for_timeout(50)
            logs_visible = page.evaluate("() => !document.getElementById('logs-panel').classList.contains('hidden')")
            self.assertTrue(logs_visible, "Logs panel should be visible after clicking mobile logs tab")

            # 2. Open mobile drawer again and switch to settings tab
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            page.locator('.mobile-nav-tab[data-tab="settings"]').click()
            page.wait_for_timeout(50)
            settings_visible = page.evaluate("() => !document.getElementById('settings-panel').classList.contains('hidden')")
            self.assertTrue(settings_visible, "Settings panel should be visible after clicking mobile settings tab")
        finally:
            page.close()

    def test_app_js_resets_hamburger_control_on_navigation(self):
        """Verify app.js switchTab auto-closes drawer and resets hamburger icon/state (ANIMU-UI-001)."""
        page = self._create_mobile_page()
        try:
            # 1. Open mobile drawer
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            state_opened = self._get_drawer_state(page)
            self.assertTrue(state_opened["isOpen"])
            self.assertEqual(state_opened["ariaLabel"], "Close menu")
            self.assertEqual(state_opened["icon"], "fa-solid fa-xmark text-lg")

            # 2. Click mobile navigation tab to trigger tab switch
            page.locator('.mobile-nav-tab[data-tab="watching"]').click()
            page.wait_for_timeout(50)
            state_closed = self._get_drawer_state(page)

            # Assert drawer auto-closes and hamburger controls reset
            self.assertFalse(state_closed["isOpen"])
            self.assertEqual(state_closed["maxHeight"], "0px")
            self.assertEqual(state_closed["icon"], "fa-solid fa-bars text-lg")
            self.assertEqual(state_closed["ariaLabel"], "Open menu")
        finally:
            page.close()

    def test_tablet_mobile_drawer_open_tab_selection_closed_drawer_hamburger_lifecycle(self):
        """Regression test for tablet/mobile drawer open -> tab selection -> closed drawer -> hamburger icon/state."""
        page = self._create_mobile_page()
        try:
            states = {}

            # Phase 1: Initial closed state
            states["initial"] = self._get_drawer_state(page)

            # Phase 2: User opens mobile/tablet drawer
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            states["drawer_opened"] = self._get_drawer_state(page)

            # Phase 3: User selects a tab (e.g. 'watching'), drawer auto-closes
            page.locator('.mobile-nav-tab[data-tab="watching"]').click()
            page.wait_for_timeout(50)
            states["tab_selected_auto_closed"] = self._get_drawer_state(page)

            # Phase 4: User opens drawer again
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            states["drawer_reopened"] = self._get_drawer_state(page)

            # Phase 5: User manually closes drawer via hamburger
            page.locator('#hamburger-btn').click()
            page.wait_for_timeout(50)
            states["drawer_closed_by_hamburger"] = self._get_drawer_state(page)

            # Phase 6: Desktop navigation while closed (does not perturb state)
            page.evaluate("() => { const b = document.querySelector('.nav-tab[data-tab=\"discover\"]'); if (b) b.click(); }")
            page.wait_for_timeout(50)
            states["desktop_nav_while_closed"] = self._get_drawer_state(page)

            # Phase 1: Initial closed state
            self.assertFalse(states['initial']['isOpen'])
            self.assertEqual(states['initial']['icon'], 'fa-solid fa-bars text-lg')
            self.assertEqual(states['initial']['ariaLabel'], 'Open menu')
            self.assertIn(states['initial']['maxHeight'], ('0px', ''))

            # Phase 2: Drawer opened
            self.assertTrue(states['drawer_opened']['isOpen'])
            self.assertEqual(states['drawer_opened']['icon'], 'fa-solid fa-xmark text-lg')
            self.assertEqual(states['drawer_opened']['ariaLabel'], 'Close menu')
            self.assertNotEqual(states['drawer_opened']['maxHeight'], '0px')

            # Phase 3: Tab selected -> drawer auto-closed -> hamburger reset
            self.assertFalse(states['tab_selected_auto_closed']['isOpen'])
            self.assertEqual(states['tab_selected_auto_closed']['icon'], 'fa-solid fa-bars text-lg')
            self.assertEqual(states['tab_selected_auto_closed']['ariaLabel'], 'Open menu')
            self.assertEqual(states['tab_selected_auto_closed']['maxHeight'], '0px')

            # Phase 4: Drawer reopened
            self.assertTrue(states['drawer_reopened']['isOpen'])
            self.assertEqual(states['drawer_reopened']['icon'], 'fa-solid fa-xmark text-lg')
            self.assertEqual(states['drawer_reopened']['ariaLabel'], 'Close menu')

            # Phase 5: Closed via hamburger
            self.assertFalse(states['drawer_closed_by_hamburger']['isOpen'])
            self.assertEqual(states['drawer_closed_by_hamburger']['icon'], 'fa-solid fa-bars text-lg')
            self.assertEqual(states['drawer_closed_by_hamburger']['ariaLabel'], 'Open menu')

            # Phase 6: Desktop navigation
            self.assertFalse(states['desktop_nav_while_closed']['isOpen'])
            self.assertEqual(states['desktop_nav_while_closed']['icon'], 'fa-solid fa-bars text-lg')
            self.assertEqual(states['desktop_nav_while_closed']['ariaLabel'], 'Open menu')
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main()
