import unittest
import os
import re

class TestMobileNavigation(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.index_path = os.path.join(self.base_dir, "webui", "index.html")
        self.app_js_path = os.path.join(self.base_dir, "webui", "app.js")

    def test_mobile_tab_elements_exist_in_html(self):
        """Verify HTML contains mobile nav tabs for watching, logs, and settings."""
        with open(self.index_path, "r", encoding="utf-8") as f:
            html = f.read()

        self.assertIn('data-tab="watching"', html)
        self.assertIn('data-tab="discover"', html)
        self.assertIn('data-tab="logs"', html)
        self.assertIn('data-tab="settings"', html)
        self.assertIn('mobile-nav-tab', html)
        self.assertIn('id="mobile-menu"', html)

    def test_app_js_binds_mobile_tabs(self):
        """Verify app.js registers click listeners for mobile-nav-tab elements."""
        with open(self.app_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        self.assertIn('mobileNavTabs:', js)
        self.assertIn('DOM.mobileNavTabs.forEach', js)
        self.assertIn('switchTab(btn.dataset.tab)', js)


if __name__ == "__main__":
    unittest.main()
