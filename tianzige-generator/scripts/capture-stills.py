#!/usr/bin/env python3
"""Capture demo stills from the LIVE site (never staged).

Opens the deployed app on a phone-size viewport, pastes a real messy teacher
list, waits for the grid to render, and saves:
  docs/demo/tianzige-phone.png          the app as a teacher sees it
  docs/demo/tianzige-print-letter.png   page 1 of the printed PDF (Letter)
  docs/demo/tianzige-print-a4.png       page 1 of the printed PDF (A4)
The PDFs are printed by Chromium from the same page (print stylesheet) and
rasterized with pdftoppm, so the PNGs show what a printer receives.

Usage: python3 scripts/capture-stills.py [URL]
"""
import os
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://tianzige-generator.joyd-ai-2026.workers.dev"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "demo")

PASTE = """第三课 生字
1. 大 dà big
2. 小 xiǎo small
3. 学校 xuéxiào school
4. 山 shān, 水 shuǐ
5. 爸爸 bàba"""

SILENCE = """
window.speechSynthesis && (window.speechSynthesis.speak = () => {});
HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
"""


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(SILENCE)
        page = ctx.new_page()
        page.goto(URL + "/?silent=1", wait_until="networkidle")
        page.fill("#chars", PASTE)
        page.wait_for_function("document.querySelectorAll('#preview svg.sheet-page').length > 0 && !document.querySelector('#print').disabled", timeout=20000)
        page.wait_for_timeout(500)
        print("momo says:", page.inner_text("#momo-says"))
        page.screenshot(path=os.path.join(OUT, "tianzige-phone.png"), full_page=False)
        page.evaluate("document.querySelector('#preview').scrollIntoView()")
        page.screenshot(path=os.path.join(OUT, "tianzige-phone-preview.png"), full_page=False)

        for paper in ("letter", "a4"):
            page.check(f"input[name=paper][value={paper}]", force=True)
            page.wait_for_timeout(600)
            with tempfile.TemporaryDirectory() as tmp:
                pdf = os.path.join(tmp, "sheet.pdf")
                page.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
                info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
                size = [l for l in info.splitlines() if l.startswith(("Pages", "Page size"))]
                print(paper, size)
                stem = os.path.join(tmp, "p")
                subprocess.run(["pdftoppm", "-png", "-r", "110", "-f", "1", "-l", "1", pdf, stem], check=True)
                made = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
                os.replace(os.path.join(tmp, made[0]), os.path.join(OUT, f"tianzige-print-{paper}.png"))
        browser.close()


if __name__ == "__main__":
    main()
