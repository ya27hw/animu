#!/usr/bin/env python3
"""
Auto-updating repository onboarding file generator for Animu.
Scans the project modules, updates module line counts / descriptions,
and ensures AGENTS.md remains up-to-date.
"""

import os
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.resolve()
AGENTS_MD_PATH = PROJECT_ROOT / "AGENTS.md"


def count_lines(filepath: Path) -> int:
    """Return line count of a text file."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def update_agents_md():
    """Update line counts and module summary in AGENTS.md."""
    if not AGENTS_MD_PATH.exists():
        print(f"{AGENTS_MD_PATH} does not exist.")
        return

    animu_dir = PROJECT_ROOT / "animu"
    webui_dir = PROJECT_ROOT / "webui"
    main_py = PROJECT_ROOT / "main.py"

    py_files = list(animu_dir.glob("*.py"))
    py_lines = sum(count_lines(f) for f in py_files) + count_lines(main_py)
    py_modules_count = len(py_files) + (1 if main_py.exists() else 0)

    html_lines = count_lines(webui_dir / "index.html")
    js_lines = count_lines(webui_dir / "app.js")
    frontend_lines = html_lines + js_lines

    content = AGENTS_MD_PATH.read_text(encoding="utf-8")

    # Update total lines summary in header
    lines_pattern = r">( \*\*\s*Lines:\*\*\s*~?)\d+\s+Python\s+\(\d+\s+modules\)\s+\+\s+\d+\s+frontend HTML/JS"
    content = re.sub(
        r">( \*\*\s*Lines:\*\*\s*~?)\d+ Python \(\d+ modules\) \+ \d+ frontend HTML/JS",
        f"> **Lines:** ~{py_lines} Python ({py_modules_count} modules) + {frontend_lines} frontend HTML/JS",
        content
    )

    # Update individual module line counts if matched
    if main_py.exists():
        content = re.sub(r"main\.py \(\d+ lines\)", f"main.py ({count_lines(main_py)} lines)", content)

    for f in py_files:
        content = re.sub(
            re.escape(f"animu/{f.name}") + r" \(\d+ lines\)",
            f"animu/{f.name} ({count_lines(f)} lines)",
            content
        )

    if (webui_dir / "index.html").exists():
        content = re.sub(r"index\.html \(\d+ lines\)", f"index.html ({count_lines(webui_dir / 'index.html')} lines)", content)
    if (webui_dir / "app.js").exists():
        content = re.sub(r"app\.js \(\d+ lines\)", f"app.js ({count_lines(webui_dir / 'app.js')} lines)", content)

    AGENTS_MD_PATH.write_text(content, encoding="utf-8")
    print(f"Updated {AGENTS_MD_PATH}")


if __name__ == "__main__":
    update_agents_md()
