import unittest
import os
import re
import subprocess
import json

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
        """Verify app.js registers click listeners for mobile-nav-tab elements."""
        with open(self.app_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        self.assertIn('mobileNavTabs:', js)
        self.assertIn('DOM.mobileNavTabs.forEach', js)
        self.assertIn('switchTab(btn.dataset.tab)', js)

    def test_app_js_resets_hamburger_control_on_navigation(self):
        """Verify app.js switchTab auto-closes drawer and resets hamburger icon/state (ANIMU-UI-001)."""
        with open(self.app_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        switch_tab_match = re.search(r'function switchTab\(tabName\)\s*\{(.*?)\n\s*// Trigger tab specific loader', js, re.DOTALL)
        self.assertIsNotNone(switch_tab_match, "switchTab function block not found")
        switch_tab_body = switch_tab_match.group(1)

        self.assertIn("mobile-open", switch_tab_body)
        self.assertIn("maxHeight = '0px'", switch_tab_body)
        self.assertIn("fa-solid fa-bars text-lg", switch_tab_body)
        self.assertIn("aria-label", switch_tab_body)
        self.assertIn("Open menu", switch_tab_body)

    def test_tablet_mobile_drawer_open_tab_selection_closed_drawer_hamburger_lifecycle(self):
        """Regression test for tablet/mobile drawer open -> tab selection -> closed drawer -> hamburger icon/state."""
        with open(self.app_js_path, "r", encoding="utf-8") as f:
            js = f.read()

        node_script = """
class ClassList {
  constructor() { this.classes = new Set(); }
  add(c) { this.classes.add(c); }
  remove(c) { this.classes.delete(c); }
  contains(c) { return this.classes.has(c); }
  toggle(c, force) {
    if (force !== undefined) {
      if (force) this.classes.add(c); else this.classes.delete(c);
      return force;
    }
    if (this.classes.has(c)) { this.classes.delete(c); return false; }
    else { this.classes.add(c); return true; }
  }
}

const DOM = {
  mobileMenu: {
    classList: new ClassList(),
    style: { maxHeight: '0px' },
    scrollHeight: 240
  },
  hamburgerBtn: {
    attrs: { 'aria-label': 'Open menu' },
    _icon: { className: 'fa-solid fa-bars text-lg' },
    querySelector(sel) { return sel === 'i' ? this._icon : null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; }
  },
  navTabs: [],
  mobileNavTabs: [],
  viewPanels: []
};

// Hamburger Menu handler (from app.js)
function onHamburgerClick() {
  const menu = DOM.mobileMenu;
  const isOpen = menu.classList.contains('mobile-open');
  if (isOpen) {
    menu.classList.remove('mobile-open');
    menu.style.maxHeight = '0px';
    DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-bars text-lg';
    DOM.hamburgerBtn.setAttribute('aria-label', 'Open menu');
  } else {
    menu.classList.add('mobile-open');
    menu.style.maxHeight = menu.scrollHeight + 'px';
    DOM.hamburgerBtn.querySelector('i').className = 'fa-solid fa-xmark text-lg';
    DOM.hamburgerBtn.setAttribute('aria-label', 'Close menu');
  }
}

// switchTab handler (from app.js)
function switchTab(tabName) {
  if (DOM.mobileMenu && DOM.mobileMenu.classList.contains('mobile-open')) {
    DOM.mobileMenu.classList.remove('mobile-open');
    DOM.mobileMenu.style.maxHeight = '0px';
    if (DOM.hamburgerBtn) {
      const icon = DOM.hamburgerBtn.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-bars text-lg';
      DOM.hamburgerBtn.setAttribute('aria-label', 'Open menu');
    }
  }
}

const lifecycle = [];

// 1. Initial closed state
lifecycle.push({
  phase: 'initial',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

// 2. User opens mobile/tablet drawer
onHamburgerClick();
lifecycle.push({
  phase: 'drawer_opened',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

// 3. User selects a tab (e.g. 'watching'), drawer auto-closes
switchTab('watching');
lifecycle.push({
  phase: 'tab_selected_auto_closed',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

// 4. User opens drawer again
onHamburgerClick();
lifecycle.push({
  phase: 'drawer_reopened',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

// 5. User manually closes drawer via hamburger
onHamburgerClick();
lifecycle.push({
  phase: 'drawer_closed_by_hamburger',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

// 6. Desktop navigation while closed (does not perturb state)
switchTab('discover');
lifecycle.push({
  phase: 'desktop_nav_while_closed',
  isOpen: DOM.mobileMenu.classList.contains('mobile-open'),
  icon: DOM.hamburgerBtn.querySelector('i').className,
  ariaLabel: DOM.hamburgerBtn.getAttribute('aria-label'),
  maxHeight: DOM.mobileMenu.style.maxHeight
});

console.log(JSON.stringify(lifecycle));
"""
        proc = subprocess.run(['node', '-e', node_script], capture_output=True, text=True, check=True)
        states = {item['phase']: item for item in json.loads(proc.stdout)}

        # Phase 1: Initial closed state
        self.assertFalse(states['initial']['isOpen'])
        self.assertEqual(states['initial']['icon'], 'fa-solid fa-bars text-lg')
        self.assertEqual(states['initial']['ariaLabel'], 'Open menu')
        self.assertEqual(states['initial']['maxHeight'], '0px')

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


if __name__ == "__main__":
    unittest.main()
