#!/usr/bin/env python3
"""Live run on the REAL site, headless and silent.

A teacher makes a room with a real list, one browser kid joins and traces every
character with real pointer drags along the stroke medians, and one AI agent
joins through agent/play.mjs. Saves stills to docs/demo/.

  python3 scripts/live-run.py [--url https://trace-race.joyd-ai-2026.workers.dev]
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "demo"
SILENT = """
  window.speechSynthesis && (window.speechSynthesis.speak = () => {});
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
"""
LIST = "1. 山 shān mountain\n2. 水 shuǐ water\n3. 火 huǒ fire\n4. 𠮷 (rare, no data)\n5. 山 again"

TRACE_JS = """
async ([char, strokeNum]) => {
  const data = await (await fetch('/api/strokes/' + encodeURIComponent(char))).json();
  const svg = document.querySelector('.writer svg');
  const g = svg.querySelector('g');
  const m = g.getScreenCTM();
  return data.medians[strokeNum].map(([x, y]) => {
    const p = svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(m);
    return [q.x, q.y];
  });
}
"""

def drag(page, pts):
    page.mouse.move(*pts[0])
    page.mouse.down()
    for a, b in zip(pts, pts[1:]):
        for t in (0.25, 0.5, 0.75, 1.0):
            page.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            page.wait_for_timeout(8)
    page.mouse.up()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://trace-race.joyd-ai-2026.workers.dev")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    log = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio"])
        teacher = browser.new_context(viewport={"width": 1100, "height": 900})
        teacher.add_init_script(SILENT)
        kidctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        kidctx.add_init_script(SILENT)
        t = teacher.new_page()
        t.goto(f"{base}/?silent=1#/")
        t.fill("textarea", LIST)
        t.click("text=Make a room")
        t.wait_for_selector(".roomcode")
        code = t.inner_text(".roomcode").strip()
        log["code"] = code
        log["missing_note"] = t.inner_text(".notice.warn") if t.query_selector(".notice.warn") else None

        k = kidctx.new_page()
        k.goto(f"{base}/?silent=1#/join/{code}")
        k.fill("input[aria-label='Your name']", "Mia")
        k.click("text=Join the race")
        k.wait_for_selector("text=You're in")

        agent = subprocess.Popen(
            ["node", str(ROOT / "agent" / "play.mjs"), "--url", base, "--room", code, "--name", "Robo",
             "--pace-ms", "1800", "--mistakes", "0.15", "--seed", "5"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t.wait_for_function("document.body.innerText.includes('Kids here (2)')", timeout=20000)
        t.screenshot(path=str(OUT / "trace-race-lobby.png"))
        t.click("text=Start the race")

        k.wait_for_selector(".writer svg g", timeout=20000)
        state = k.evaluate("async (c) => { const s = JSON.parse(localStorage.getItem('trace-race:seat:' + c)); const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}}); return (await r.json()).state; }", code)
        chars = state["roundChars"]
        counts = state["list"]["strokeCounts"]
        log["roundChars"] = chars
        for ci, ch in enumerate(chars):
            k.wait_for_selector(f".writer[data-char='{ch}'] svg g", timeout=15000)
            k.wait_for_timeout(600)
            for s in range(counts[ch]):
                drag(k, k.evaluate(TRACE_JS, [ch, s]))
                k.wait_for_timeout(350)
                if ci == 1 and s == 1:
                    k.screenshot(path=str(OUT / "trace-race-kid-tracing.png"))
                    t.screenshot(path=str(OUT / "trace-race-board-live.png"))
            if ci == 0:
                k.wait_for_selector(".cheer", timeout=5000)
                k.screenshot(path=str(OUT / "trace-race-kid-cheer.png"))
        t.wait_for_selector("text=Winners!", timeout=120000)
        t.wait_for_timeout(1200)
        t.screenshot(path=str(OUT / "trace-race-winners.png"))
        try:
            out, _ = agent.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            agent.kill()
            out, _ = agent.communicate()
        log["agent_output"] = out.strip().splitlines()[-6:]
        log["board"] = t.inner_text(".board")
        browser.close()
    print(json.dumps(log, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
