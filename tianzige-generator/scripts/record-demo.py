#!/usr/bin/env python3
"""Record the demo on the LIVE site (never staged or mocked). Silent.

A phone-size Chromium opens the deployed app with ?silent=1 (speech and media
playback stubbed), types a real messy teacher list, flips a few options, and
scrolls through the live preview. Outputs, in docs/demo/:
  tianzige-generator-demo.mp4   h264, faststart
  tianzige-generator-demo.gif   390 px wide, 10 fps, under 8 MB
The raw .webm goes to docs/demo/_video_raw/ (git-ignored).

Usage: python3 scripts/record-demo.py [URL]
"""
import os
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://tianzige-generator.joyd-ai-2026.workers.dev"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "demo")
RAW = os.path.join(OUT, "_video_raw")
MAX_GIF_BYTES = 8 * 1024 * 1024
SIZE = {"width": 390, "height": 844}

PASTE = """第三课 生字：
1. 大 dà big
2. 学校 xuéxiào school
3. 山 shān, 水 shuǐ
4. 画蛇添足"""

SILENCE = """
window.speechSynthesis && (window.speechSynthesis.speak = () => {});
HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
"""


def record() -> str:
    shutil.rmtree(RAW, ignore_errors=True)
    os.makedirs(RAW, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=SIZE, device_scale_factor=1, record_video_dir=RAW, record_video_size=SIZE)
        ctx.add_init_script(SILENCE)
        page = ctx.new_page()
        page.goto(URL + "/?silent=1", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.click("#chars")
        page.keyboard.type(PASTE, delay=45)
        page.wait_for_function("!document.querySelector('#print').disabled", timeout=20000)
        page.wait_for_timeout(1500)
        for name, value in (("grid", "mi"), ("trace", "1"), ("perRow", "6")):
            span = page.locator(f"label:has(input[name={name}][value='{value}']) span")
            span.scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            span.click()
            page.wait_for_function("!document.querySelector('#print').disabled", timeout=20000)
            page.wait_for_timeout(900)
        page.locator("label:has(input[name=perRow][value='8']) span").click()
        page.wait_for_function("!document.querySelector('#print').disabled", timeout=20000)
        for _ in range(14):
            page.mouse.wheel(0, 320)
            page.wait_for_timeout(260)
        page.wait_for_timeout(800)
        page.evaluate("window.scrollTo({top: 0, behavior: 'smooth'})")
        page.wait_for_timeout(1500)
        print("momo says:", page.inner_text("#momo-says"))
        video = page.video.path()
        ctx.close()
        browser.close()
    return video


def encode(raw: str) -> None:
    mp4 = os.path.join(OUT, "tianzige-generator-demo.mp4")
    gif = os.path.join(OUT, "tianzige-generator-demo.gif")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ss", "0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", "-crf", "23", "-an", mp4],
        check=True,
    )
    fps = 10
    while True:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ss", "0.8", "-filter_complex",
             f"[0:v]fps={fps},scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
             "-loop", "0", gif],
            check=True,
        )
        size = os.path.getsize(gif)
        print(f"gif {size} bytes at {fps} fps; mp4 {os.path.getsize(mp4)} bytes")
        if size <= MAX_GIF_BYTES or fps <= 4:
            break
        fps -= 2
    if os.path.getsize(gif) > MAX_GIF_BYTES:
        sys.exit("gif is still over 8 MB")


if __name__ == "__main__":
    encode(record())
