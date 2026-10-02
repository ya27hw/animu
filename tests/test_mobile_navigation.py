"""Browser tests for the single-page UI's navigation (phone tab bar, desktop rail,
command palette, keyboard shortcuts). They run the real handler and the built
assets in webui/. If no browser can be launched (CI without Chrome/Chromium
installed) the whole module is skipped rather than failing."""
import http.server
import threading
import unittest

from animu.web import AnimuHTTPHandler

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None


def _launch(pw):
    for kwargs in ({"channel": "chrome"}, {}):
        try:
            return pw.chromium.launch(headless=True, **kwargs)
        except Exception:
            continue
    return None


@unittest.skipIf(sync_playwright is None, "playwright is not installed")
class TestNavigation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = _launch(cls.pw)
        if cls.browser is None:
            cls.pw.stop()
            raise unittest.SkipTest("no Chromium/Chrome available for Playwright")
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), AnimuHTTPHandler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "browser", None):
            cls.browser.close()
        if getattr(cls, "pw", None):
            cls.pw.stop()
        if getattr(cls, "server", None):
            cls.server.shutdown()
            cls.server.server_close()

    def _page(self, width, height, path="/"):
        ctx = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{self.port}{path}")
        page.wait_for_selector("#main h1", timeout=10000)
        return page

    # ------------------------------------------------------------------ phone

    def test_phone_shows_tab_bar_and_hides_the_rail(self):
        page = self._page(375, 667)
        self.assertTrue(page.locator("nav.tabs").is_visible())
        self.assertFalse(page.locator("aside[aria-label=Primary]").is_visible())
        self.assertEqual(self.errors, [])

    def test_phone_tab_navigation_changes_page_and_url(self):
        page = self._page(375, 667)
        page.locator("nav.tabs >> text=Library").click()
        page.wait_for_selector("#main h1:has-text('Library')")
        self.assertTrue(page.url.endswith("/library"))
        page.locator("nav.tabs >> text=Queue").click()
        page.wait_for_selector("#main h1:has-text('Queue')")
        self.assertTrue(page.url.endswith("/queue"))

    def test_phone_more_menu_reaches_settings(self):
        page = self._page(375, 667)
        page.locator("nav.tabs >> text=More").click()
        page.locator("[role=menuitem]:has-text('Settings')").click()
        page.wait_for_selector("#main h1:has-text('Settings')")
        self.assertTrue(page.url.endswith("/settings"))

    def test_phone_has_no_horizontal_overflow_on_any_page(self):
        for path in ("/", "/library", "/discover", "/queue", "/history", "/activity", "/settings"):
            page = self._page(375, 667, path)
            page.wait_for_timeout(300)
            overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            self.assertLessEqual(overflow, 1, f"horizontal overflow on {path}")

    # ---------------------------------------------------------------- desktop

    def test_desktop_shows_rail_and_hides_tab_bar(self):
        page = self._page(1280, 800)
        self.assertTrue(page.locator("aside[aria-label=Primary]").is_visible())
        self.assertFalse(page.locator("nav.tabs").is_visible())

    def test_rail_marks_the_current_page(self):
        page = self._page(1280, 800, "/queue")
        current = page.locator("aside[aria-label=Primary] a[aria-current=page]")
        self.assertEqual(current.count(), 1)
        self.assertIn("Queue", current.inner_text())

    def test_browser_back_and_forward_follow_client_side_routes(self):
        page = self._page(1280, 800)
        page.locator("aside[aria-label=Primary] >> text=Library").click()
        page.wait_for_selector("#main h1:has-text('Library')")
        page.locator("aside[aria-label=Primary] >> text=History").click()
        page.wait_for_selector("#main h1:has-text('History')")
        page.go_back()
        page.wait_for_selector("#main h1:has-text('Library')")
        page.go_forward()
        page.wait_for_selector("#main h1:has-text('History')")

    def test_deep_link_to_a_page_renders_it(self):
        page = self._page(1280, 800, "/activity")
        self.assertTrue(page.locator("#main h1:has-text('Activity')").is_visible())

    def test_command_palette_opens_filters_and_closes(self):
        page = self._page(1280, 800)
        page.keyboard.press("Control+k")
        page.wait_for_selector("dialog.palette[open]")
        page.keyboard.type("setti")
        self.assertTrue(page.locator("dialog.palette [role=option]:has-text('Settings')").is_visible())
        page.keyboard.press("Enter")
        page.wait_for_selector("#main h1:has-text('Settings')")
        self.assertFalse(page.locator("dialog.palette[open]").count())

    def test_escape_closes_the_palette(self):
        page = self._page(1280, 800)
        page.keyboard.press("/")
        page.wait_for_selector("dialog.palette[open]")
        page.keyboard.press("Escape")
        page.wait_for_selector("dialog.palette[open]", state="detached")

    def test_go_to_shortcuts(self):
        page = self._page(1280, 800)
        page.keyboard.press("g")
        page.keyboard.press("q")
        page.wait_for_selector("#main h1:has-text('Queue')")

    def test_theme_toggle_persists(self):
        page = self._page(1280, 800)
        page.locator("aside[aria-label=Primary] button[aria-label='Toggle theme']").click()
        first = page.evaluate("document.documentElement.dataset.theme")
        page.reload()
        page.wait_for_selector("#main h1")
        self.assertEqual(page.evaluate("document.documentElement.dataset.theme"), first)

    def test_no_third_party_requests(self):
        ctx = self.browser.new_context(viewport={"width": 1280, "height": 800})
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        hosts = set()
        page.on("request", lambda r: hosts.add(r.url.split("/")[2]))
        page.goto(f"http://127.0.0.1:{self.port}/")
        page.wait_for_selector("#main h1")
        page.wait_for_timeout(500)
        self.assertEqual({h for h in hosts if not h.startswith("127.0.0.1")}, set())

    def test_detail_sheet_renders_single_toasts_host_above_dialog(self):
        page = self._page(1280, 800, "/library")
        self.assertEqual(page.locator(".toasts").count(), 1)
        self.assertEqual(page.locator("dialog.sheet").count(), 0)

        # Open detail sheet via deep link client route
        page.evaluate("window.history.pushState(null, '', '/library/12345'); window.dispatchEvent(new PopStateEvent('popstate'));")
        page.wait_for_selector("dialog.sheet[open]")

        # Exactly one .toasts host must exist (no duplication), inside the open dialog
        self.assertEqual(page.locator(".toasts").count(), 1)
        self.assertEqual(page.locator("dialog.sheet .toasts").count(), 1)

        # Close the sheet
        page.locator("dialog.sheet button[aria-label=Close]").click()
        page.wait_for_selector("dialog.sheet[open]", state="detached")

        # After closing, exactly one .toasts host remains
        self.assertEqual(page.locator(".toasts").count(), 1)
        self.assertEqual(page.locator("dialog.sheet").count(), 0)

    def test_anime_click_keeps_document_without_full_reload(self):
        page = self._page(1280, 800, "/discover")
        page.evaluate("window.__test_document_alive = true")

        # Navigate into anime view
        page.evaluate("window.history.pushState(null, '', '/discover/12345'); window.dispatchEvent(new PopStateEvent('popstate'));")
        page.wait_for_selector("dialog.sheet[open]")
        self.assertTrue(page.evaluate("window.__test_document_alive"))

        # Close anime view
        page.locator("dialog.sheet button[aria-label=Close]").click()
        page.wait_for_selector("dialog.sheet[open]", state="detached")
        self.assertTrue(page.evaluate("window.__test_document_alive"))


if __name__ == "__main__":
    unittest.main()
