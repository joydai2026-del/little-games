#!/usr/bin/env python3
"""Live run on the REAL site, headless and silent (audio stubbed, Chromium muted).

A teacher makes a room with a real list, one browser kid joins and traces every
character with real pointer drags along the stroke medians, and one AI agent
joins through agent/play.mjs. Saves stills to docs/demo/.

  python3 scripts/live-run.py                 # plain run, stills
  python3 scripts/live-run.py --blip          # also cut the kid's stroke sends for
                                              # 6 s mid-race and check the phone and
                                              # the room agree at the end
  python3 scripts/live-run.py --record        # also record the demo: mp4 + gif
"""
import argparse, json, shutil, subprocess, sys, time
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

PROGRESS_JS = """
async (c) => {
  const s = JSON.parse(localStorage.getItem('trace-race:seat:' + c));
  const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}});
  const st = (await r.json()).state;
  return { phase: st.phase, me: st.progress[st.you] || null, roundChars: st.roundChars, you: st.you };
}
"""

TEACHER_VERSION_JS = """
async (c) => {
  const s = JSON.parse(localStorage.getItem('trace-race:seat:' + c));
  const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}});
  return (await r.json()).state.version;
}
"""

TEACHER_PROGRESS_JS = """
async ([c, kid]) => {
  const s = JSON.parse(localStorage.getItem('trace-race:seat:' + c));
  const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}});
  const st = (await r.json()).state;
  return { phase: st.phase, me: st.progress[kid] || null };
}
"""

MAX_GIF_BYTES = 8 * 1024 * 1024


def encode_demo(kid_webm, board_webm, log):
    """Side-by-side (phone left, board right) mp4 + gif under 8 MB."""
    ff = shutil.which("ffmpeg")
    if not ff:
        log["demo"] = "ffmpeg missing, no video"
        return
    mp4 = OUT / "trace-race-demo.mp4"
    gif = OUT / "trace-race-demo.gif"
    stack = "[0:v]scale=-2:844,setsar=1[a];[1:v]scale=-2:844,setsar=1[b];[a][b]hstack=inputs=2,setpts=PTS/1.25"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(kid_webm), "-i", str(board_webm), "-filter_complex", stack,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-an", "-movflags", "+faststart", str(mp4)], check=True)
    for width, fps in ((820, 8), (680, 7), (560, 6), (460, 5)):
        vf = f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer"
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(mp4), "-vf", vf, str(gif)], check=True)
        if gif.stat().st_size <= MAX_GIF_BYTES:
            break
    log["demo"] = {"mp4": mp4.name, "mp4_bytes": mp4.stat().st_size, "gif": gif.name, "gif_bytes": gif.stat().st_size, "gif_width": width, "gif_fps": fps}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://trace-race.averystudio.org")
    ap.add_argument("--blip", action="store_true")
    ap.add_argument("--cut", choices=["abort", "hang"], default="abort",
                    help="abort: sends fail at once; hang: sends never answer (the phone's timeout must fire)")
    ap.add_argument("--cut-seconds", type=float, default=6.0, help="how long the cut lasts")
    ap.add_argument("--cut-scope", choices=["strokes", "all"], default="strokes",
                    help="strokes: only stroke sends; all: every room request, polls included (a full outage)")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--no-agent", action="store_true", help="solo kid: nothing else changes the room during a cut")
    args = ap.parse_args()
    raw = OUT / "_raw"
    base = args.url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    import os, datetime
    log = {"url": base, "deployed_version": os.environ.get("TRACE_RACE_VERSION"), "deployed_commit": os.environ.get("TRACE_RACE_COMMIT"),
           "args": vars(args), "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio"])
        rec_t = {"record_video_dir": str(raw / "board"), "record_video_size": {"width": 1100, "height": 900}} if args.record else {}
        rec_k = {"record_video_dir": str(raw / "kid"), "record_video_size": {"width": 390, "height": 844}} if args.record else {}
        teacher = browser.new_context(viewport={"width": 1100, "height": 900}, **rec_t)
        teacher.add_init_script(SILENT)
        kidctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, **rec_k)
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

        agent = None if args.no_agent else subprocess.Popen(
            ["node", str(ROOT / "agent" / "play.mjs"), "--url", base, "--room", code, "--name", "Robo",
             "--pace-ms", "1800", "--mistakes", "0.15", "--seed", "5"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t.wait_for_function(f"document.body.innerText.includes('Kids here ({1 if args.no_agent else 2})')", timeout=20000)
        t.screenshot(path=str(OUT / "trace-race-lobby.png"))
        t.click("text=Start the race")

        k.wait_for_selector(".writer svg g", timeout=20000)
        first = k.evaluate(PROGRESS_JS, code)
        chars = first["roundChars"]
        kid_id = first["you"]
        log["roundChars"] = chars
        # Trace whatever the pad shows next (character from data-char, stroke =
        # filled dots), so the loop follows the pad if it resyncs with the room.
        blip_started = None
        hung = []
        shots = set()
        deadline = time.time() + 150
        while time.time() < deadline:
            if blip_started and time.time() - blip_started > args.cut_seconds and "unrouted" not in log.get("blip", {}):
                k.unroute(log["cut_pattern"])
                log["blip"]["unrouted"] = True
                log["blip"]["unrouted_after_s"] = round(time.time() - blip_started, 1)
                log["blip"]["requests_left_hanging"] = len(hung)
                log["blip"]["server_at_unroute"] = t.evaluate(TEACHER_PROGRESS_JS, [code, kid_id])["me"]
                log["blip"]["phone_screen_at_unroute"] = k.inner_text("#app")[:120]
                log["blip"]["room_version_at_unroute"] = t.evaluate(TEACHER_VERSION_JS, code)
            prog = t.evaluate(TEACHER_PROGRESS_JS, [code, kid_id])
            if prog["phase"] != "racing" or (prog["me"] and prog["me"]["finishedAt"]):
                if not k.query_selector(".cheer"):
                    break
            if k.query_selector(".cheer"):
                if "cheer" not in shots:
                    shots.add("cheer")
                    k.screenshot(path=str(OUT / "trace-race-kid-cheer.png"))
                k.wait_for_timeout(250)
                continue
            w = k.query_selector(".writer[data-char] svg g")
            if not w:
                k.wait_for_timeout(250)
                continue
            ch = k.get_attribute(".writer[data-char]", "data-char")
            stroke = len(k.query_selector_all(".dot.done"))
            total = len(k.query_selector_all(".dot"))
            if stroke >= total:
                k.wait_for_timeout(250)
                continue
            if args.blip and blip_started is None and ch == chars[1]:
                blip_started = time.time()
                pattern = "**/stroke" if args.cut_scope == "strokes" else "**/api/rooms/**"
                log["cut_pattern"] = pattern
                if args.cut == "abort":
                    k.route(pattern, lambda route: route.abort())
                else:
                    hung.clear()
                    k.route(pattern, lambda route: hung.append(route))  # never answered
                log["room_version_at_cut"] = t.evaluate(TEACHER_VERSION_JS, code)
                log["blip"] = {"mode": args.cut, "seconds": args.cut_seconds, "char": ch, "cut_at_stroke": stroke, "cut_at": time.time()}
            drag(k, k.evaluate(TRACE_JS, [ch, stroke]))
            k.wait_for_timeout(450)
            if ch == chars[1] and stroke == 1 and "tracing" not in shots:
                shots.add("tracing")
                k.screenshot(path=str(OUT / "trace-race-kid-tracing.png"))
                t.screenshot(path=str(OUT / "trace-race-board-live.png"))
            if args.blip and log.get("blip", {}).get("unrouted") and k.query_selector("text=internet hiccuped") and "resynced" not in log["blip"]:
                log["blip"]["resynced"] = True
        t.wait_for_selector("text=Winners!", timeout=120000)
        t.wait_for_timeout(1200)
        t.screenshot(path=str(OUT / "trace-race-winners.png"))
        if agent:
            try:
                out, _ = agent.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                agent.kill()
                out, _ = agent.communicate()
            log["agent_output"] = out.strip().splitlines()[-6:]
        log["board"] = t.inner_text(".board")
        k.wait_for_timeout(1500)
        log["kid_screen"] = k.inner_text("#app")[:200]
        log["server_final"] = t.evaluate(TEACHER_PROGRESS_JS, [code, kid_id])["me"]
        log["phone_and_room_agree"] = ("You are number" in log["kid_screen"] or "finished" in log["kid_screen"].lower()) and bool(log["server_final"] and log["server_final"]["finishedAt"])
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
