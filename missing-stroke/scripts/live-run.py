#!/usr/bin/env python3
"""Live run on the REAL site, headless and silent (audio stubbed, Chromium muted).

A teacher makes a class room with a real list, one browser kid (Mia) joins and,
for every character, draws the missing stroke with real pointer drags along the
stroke's median (on the first character she first draws it BACKWARDS, a real
wrong stroke, so the pad wiggles), and one AI agent plays through
agent/play.mjs. Saves stills to docs/demo/ and prints a JSON log.

  python3 scripts/live-run.py [--url https://missing-stroke.joyd-ai-2026.workers.dev]
  python3 scripts/live-run.py --record        # also record the demo: mp4 + gif
  python3 scripts/live-run.py --solo          # solo mode on one phone (no room): every character drawn
"""
import argparse, datetime, json, os, shutil, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "demo"
SILENT = """
  window.speechSynthesis && (window.speechSynthesis.speak = () => {});
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
"""
LIST = "1. 山 shān mountain\n2. 水 shuǐ water\n3. 火 huǒ fire\n4. 𠮷 (rare, no data)\n5. 山 again"

# Screen points along one stroke's median, through the writer's own transform.
MEDIAN_JS = """
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

STATE_JS = """
async (c) => {
  const s = JSON.parse(localStorage.getItem('missing-stroke:seat:' + c));
  const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}});
  const st = (await r.json()).state;
  return { phase: st.phase, turn: st.turn, me: st.progress[st.you] || null, standings: st.standings, results: st.results, round: st.round };
}
"""

def drag(page, pts):
    page.mouse.move(*pts[0])
    page.mouse.down()
    for a, b in zip(pts, pts[1:]):
        for t in (0.25, 0.5, 0.75, 1.0):
            page.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            page.wait_for_timeout(10)
    page.mouse.up()

MAX_GIF_BYTES = 8 * 1024 * 1024


def encode_demo(kid_webm, board_webm, log):
    """Side-by-side (phone left, class board right) mp4 + gif under 8 MB."""
    ff = shutil.which("ffmpeg")
    if not ff:
        log["demo"] = "ffmpeg missing, no video"
        return
    mp4 = OUT / "missing-stroke-demo.mp4"
    gif = OUT / "missing-stroke-demo.gif"
    stack = "[0:v]scale=-2:844,setsar=1[a];[1:v]scale=-2:844,setsar=1[b];[a][b]hstack=inputs=2,setpts=PTS/1.25"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(kid_webm), "-i", str(board_webm), "-filter_complex", stack,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-an", "-movflags", "+faststart", str(mp4)], check=True)
    for width, fps in ((820, 8), (680, 7), (560, 6), (460, 5)):
        vf = f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer"
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(mp4), "-vf", vf, str(gif)], check=True)
        if gif.stat().st_size <= MAX_GIF_BYTES:
            break
    log["demo"] = {"mp4": mp4.name, "mp4_bytes": mp4.stat().st_size, "gif": gif.name, "gif_bytes": gif.stat().st_size, "gif_width": width, "gif_fps": fps}


def solo_run(base, level):
    """Solo on one phone: paste, Play by myself, draw every missing stroke, read the result screen."""
    log = {"mode": "solo", "url": base, "moves": [], "console_errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True)
        ctx.add_init_script(SILENT)
        k = ctx.new_page()
        k.on("console", lambda m: m.type == "error" and log["console_errors"].append(m.text))
        k.goto(f"{base}/#/")
        k.fill("textarea", "人 口 大 小 日")
        k.click(f"button[data-level='{level}']")
        k.click("text=Play by myself")
        k.wait_for_url("**/#/solo", timeout=20000)
        seen = set()
        deadline = time.time() + 150
        while time.time() < deadline:
            if k.query_selector("text=/You found [0-9]+ of/"):
                break
            el = k.query_selector(".writer[data-hidden]")
            if not el or not k.query_selector(".writer[data-hidden] svg g") or k.query_selector(".pad-wrap.right"):
                k.wait_for_timeout(200)
                continue
            key = (el.get_attribute("data-char"), el.get_attribute("data-hidden"))
            if key in seen:
                k.wait_for_timeout(200)
                continue
            seen.add(key)
            k.wait_for_timeout(500)
            drag(k, k.evaluate(MEDIAN_JS, [key[0], int(key[1])]))
            k.wait_for_timeout(300)
            log["moves"].append({"char": key[0], "hidden": int(key[1]), "pad_turned_right": k.query_selector(".pad-wrap.right") is not None})
        k.wait_for_selector("text=/You found [0-9]+ of/", timeout=60000)
        k.wait_for_timeout(1200)
        k.screenshot(path=str(OUT / "missing-stroke-solo-done.png"))
        log["result_screen"] = k.inner_text("#app")[:200]
        browser.close()
    print(json.dumps(log, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://missing-stroke.joyd-ai-2026.workers.dev")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--level", default="middle", choices=["little", "middle", "big"])
    ap.add_argument("--no-agent", action="store_true")
    ap.add_argument("--solo", action="store_true")
    args = ap.parse_args()
    if args.solo:
        OUT.mkdir(parents=True, exist_ok=True)
        return solo_run(args.url.rstrip("/"), args.level)
    raw = OUT / "_raw"
    base = args.url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    log = {"url": base, "deployed_version": os.environ.get("MISSING_STROKE_VERSION"), "deployed_commit": os.environ.get("MISSING_STROKE_COMMIT"),
           "args": vars(args), "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "kid_moves": [], "console_errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio"])
        rec_t = {"record_video_dir": str(raw / "board"), "record_video_size": {"width": 1100, "height": 900}} if args.record else {}
        rec_k = {"record_video_dir": str(raw / "kid"), "record_video_size": {"width": 390, "height": 844}} if args.record else {}
        teacher = browser.new_context(viewport={"width": 1100, "height": 900}, **rec_t)
        teacher.add_init_script(SILENT)
        kidctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, **rec_k)
        kidctx.add_init_script(SILENT)
        t = teacher.new_page()
        t.on("console", lambda m: m.type == "error" and log["console_errors"].append(["teacher", m.text]))
        t.goto(f"{base}/#/")
        t.fill("textarea", LIST)
        t.click(f"button[data-level='{args.level}']")
        t.click("text=Make a class room")
        t.wait_for_selector(".roomcode")
        code = t.inner_text(".roomcode").strip()
        log["code"] = code
        log["missing_note"] = t.inner_text(".notice.warn") if t.query_selector(".notice.warn") else None

        k = kidctx.new_page()
        k.on("console", lambda m: m.type == "error" and log["console_errors"].append(["kid", m.text]))
        k.goto(f"{base}/#/join/{code}")
        k.fill("input[aria-label='Your name']", "Mia")
        k.click("text=Join the game")
        k.wait_for_selector("text=You're in")

        agent = None if args.no_agent else subprocess.Popen(
            ["node", str(ROOT / "agent" / "play.mjs"), "--url", base, "--room", code, "--name", "Robo",
             "--pace-ms", "3200", "--mistakes", "0.3", "--seed", "4"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t.wait_for_function(f"document.body.innerText.includes('Kids here ({1 if args.no_agent else 2})')", timeout=20000)
        t.screenshot(path=str(OUT / "missing-stroke-lobby.png"))
        t.click("text=Start the game")

        done_turns = set()
        shots = set()
        deadline = time.time() + 180
        while time.time() < deadline:
            st = t.evaluate(STATE_JS, code)
            if st["phase"] == "done":
                break
            turn = st["turn"]
            w = k.query_selector(".writer[data-hidden] svg g")
            if not turn or turn["closedAt"] is not None or turn["index"] in done_turns or not w:
                if turn and turn["closedAt"] is not None and "reveal" not in shots and turn["index"] == 0:
                    t.wait_for_timeout(600)
                    shots.add("reveal")
                    k.screenshot(path=str(OUT / "missing-stroke-kid-reveal.png"))
                    t.screenshot(path=str(OUT / "missing-stroke-board-reveal.png"))
                k.wait_for_timeout(200)
                continue
            ch = k.get_attribute(".writer[data-hidden]", "data-char")
            hidden = int(k.get_attribute(".writer[data-hidden]", "data-hidden"))
            k.wait_for_timeout(700)  # a kid looks before drawing
            if turn["index"] == 0 and "pad" not in shots:
                shots.add("pad")
                k.screenshot(path=str(OUT / "missing-stroke-kid-pad.png"))
            pts = k.evaluate(MEDIAN_JS, [ch, hidden])
            if turn["index"] == 0:
                drag(k, list(reversed(pts)))  # backwards: a real wrong stroke
                k.wait_for_timeout(700)
                log["kid_moves"].append({"char": ch, "hidden": hidden, "move": "backwards (wrong)", "pad_wiggled": k.query_selector(".pad-wrap.wiggle") is not None})
            drag(k, pts)
            k.wait_for_timeout(300)
            right_class = k.query_selector(".pad-wrap.right") is not None
            log["kid_moves"].append({"char": ch, "hidden": hidden, "move": "right", "pad_turned_right": right_class})
            done_turns.add(turn["index"])
            if "board" not in shots:
                t.wait_for_timeout(900)
                shots.add("board")
                t.screenshot(path=str(OUT / "missing-stroke-board-live.png"))
        t.wait_for_selector("text=Winners!", timeout=120000)
        t.wait_for_timeout(1500)
        t.screenshot(path=str(OUT / "missing-stroke-winners.png"))
        k.wait_for_timeout(1500)
        k.screenshot(path=str(OUT / "missing-stroke-kid-done.png"))
        if agent:
            try:
                out, _ = agent.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                agent.kill()
                out, _ = agent.communicate()
            log["agent_output"] = out.strip().splitlines()[-8:]
        final = t.evaluate(STATE_JS, code)
        log["final"] = {"phase": final["phase"], "standings": final["standings"],
                        "results": [{"char": r["char"], "hidden": r["hidden"], "winners": len(r["winners"]), "times": list(r["times"].values())} for r in final["results"]]}
        log["board_text"] = t.inner_text(".board")
        log["kid_screen"] = k.inner_text("#app")[:240]
        kid_video = k.video.path() if args.record else None
        board_video = t.video.path() if args.record else None
        teacher.close()
        kidctx.close()
        browser.close()
        if args.record:
            encode_demo(kid_video, board_video, log)
    log["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(log, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
