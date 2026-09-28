#!/usr/bin/env python3
"""Live run on the REAL site, headless and silent (audio stubbed, Chromium muted,
?silent=1 so the page never calls play(); the word clips are still downloaded).

A teacher makes a room from a real list and taps Easy. One browser kid joins and
writes every word with real pointer drags along the stroke medians; one AI agent
joins through agent/play.mjs. Round 2 the teacher taps Hard (no outline) and the
kid writes from memory; one word is made to fail once so the kid sees
"Try again / Skip" and taps Try again. Saves stills to docs/demo/.

  python3 scripts/live-run.py             # run + stills
  python3 scripts/live-run.py --record    # also record the demo: mp4 + gif (under 8 MB)
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
LIST = "1. 朋友 péngyou friend\n2. 大山 dàshān big mountain\n3. 学校 xuéxiào school\n4. 𠮷祥 (no stroke data)\n5. 上下 shàngxià up and down"
MAX_GIF_BYTES = 8 * 1024 * 1024

MEDIANS_JS = """
async ([char, strokeNum]) => {
  const data = await (await fetch('/api/strokes/' + encodeURIComponent(char))).json();
  const g = document.querySelector('.writer svg g');
  const svg = g.ownerSVGElement;
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
  const s = JSON.parse(localStorage.getItem('dictation-dash:seat:' + c));
  const r = await fetch('/api/rooms/' + c, {headers: {'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}});
  const st = (await r.json()).state;
  return { phase: st.phase, round: st.round, level: st.options.level, words: st.roundWords, me: st.progress[st.you] || null, you: st.you, standings: st.standings };
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


def encode_demo(kid_webm, board_webm, log):
    """Side by side (phone left, board right) mp4 + gif under 8 MB."""
    ff = shutil.which("ffmpeg")
    if not ff:
        log["demo"] = "ffmpeg missing, no video"
        return
    mp4 = OUT / "dictation-dash-demo.mp4"
    gif = OUT / "dictation-dash-demo.gif"
    stack = "[0:v]scale=-2:844,setsar=1[a];[1:v]scale=-2:844,setsar=1[b];[a][b]hstack=inputs=2,setpts=PTS/1.4"
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(kid_webm), "-i", str(board_webm), "-filter_complex", stack,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-an", "-movflags", "+faststart", str(mp4)], check=True)
    for width, fps in ((820, 8), (680, 7), (560, 6), (460, 5), (400, 4)):
        vf = f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer"
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(mp4), "-vf", vf, str(gif)], check=True)
        if gif.stat().st_size <= MAX_GIF_BYTES:
            break
    log["demo"] = {"mp4": mp4.name, "mp4_bytes": mp4.stat().st_size, "gif": gif.name, "gif_bytes": gif.stat().st_size, "gif_width": width, "gif_fps": fps}


def write_round(k, t, code, log, tag, expected_round, fail_word=None, shots=None):
    """Writes whatever the pad shows next until this kid has finished round `expected_round`."""
    shots = shots or {}
    deadline = time.time() + 240
    while time.time() < deadline:  # the teacher's tap reaches the room first
        st = k.evaluate(STATE_JS, code)
        if st["round"] >= expected_round and st["phase"] == "racing":
            break
        k.wait_for_timeout(250)
    failed_once = False
    while time.time() < deadline:
        st = k.evaluate(STATE_JS, code)
        me = st["me"]
        if st["phase"] != "racing" or (me and me["finishedAt"]):
            if not k.query_selector(".cheer"):
                break
        if fail_word is not None and not failed_once and me and me["wordIndex"] >= fail_word - 1 and k.query_selector(".cheer"):
            # Arm the silent-mode rehearsal hook during the cheer, so the NEXT word fails to start once.
            k.evaluate("window.__ddSilentSpeak = 'reject'")
            k.wait_for_selector(".problem", timeout=20000)
            log[f"{tag}_problem_text"] = k.inner_text(".problem")
            if shots.get("problem"):
                k.screenshot(path=str(OUT / shots["problem"]))
            k.evaluate("window.__ddSilentSpeak = undefined")
            k.wait_for_timeout(900)
            k.click("text=Try again")
            failed_once = True
            log[f"{tag}_try_again_clicked"] = True
            continue
        if k.query_selector(".cheer"):
            if "cheer" in shots and shots["cheer"] and not (OUT / shots["cheer"]).exists():
                k.wait_for_timeout(500)
                k.screenshot(path=str(OUT / shots["cheer"]))
            k.wait_for_timeout(250)
            continue
        w = k.query_selector(".writer[data-char] svg g")
        if not w:
            k.wait_for_timeout(250)
            continue
        ch = k.get_attribute(".writer[data-char]", "data-char")
        stroke = int(k.get_attribute(".writer[data-char]", "data-stroke") or 0)
        pts = k.evaluate(MEDIANS_JS, [ch, stroke])
        if stroke >= 1 and shots.get("writing") and not (OUT / shots["writing"]).exists():
            k.screenshot(path=str(OUT / shots["writing"]))
            if shots.get("board"):
                t.screenshot(path=str(OUT / shots["board"]))
        drag(k, pts)
        k.wait_for_timeout(420)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://dictation-dash.joyd-ai-2026.workers.dev")
    ap.add_argument("--record", action="store_true")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    raw = OUT / "_raw"
    OUT.mkdir(parents=True, exist_ok=True)
    log = {"url": base, "deployed_version": os.environ.get("DD_VERSION"), "deployed_commit": os.environ.get("DD_COMMIT"),
           "args": vars(args), "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    for old in OUT.glob("dictation-dash-*.png"):
        old.unlink()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio", "--autoplay-policy=user-gesture-required"])
        rec_t = {"record_video_dir": str(raw / "board"), "record_video_size": {"width": 1100, "height": 900}} if args.record else {}
        rec_k = {"record_video_dir": str(raw / "kid"), "record_video_size": {"width": 390, "height": 844}} if args.record else {}
        teacher = browser.new_context(viewport={"width": 1100, "height": 900}, **rec_t)
        teacher.add_init_script(SILENT)
        kidctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=False, **rec_k)
        kidctx.add_init_script(SILENT)
        t = teacher.new_page()
        t.goto(f"{base}/?silent=1#/")
        t.fill("textarea[aria-label='Word list']", LIST)
        t.click("text=Make a room")
        t.wait_for_selector(".roomcode")
        code = t.inner_text(".roomcode").strip()
        log["code"] = code
        log["left_out_notes"] = [n.inner_text() for n in t.query_selector_all(".notice.warn")]

        k = kidctx.new_page()
        k.goto(f"{base}/?silent=1#/join/{code}")
        k.fill("input[aria-label='Your name']", "Mia")
        k.click("text=Join the race")
        k.wait_for_selector("text=You're in")

        agent = subprocess.Popen(["node", str(ROOT / "agent" / "play.mjs"), "--url", base, "--room", code, "--name", "Robo",
                                  "--pace-ms", "2200", "--mistakes", "0.15", "--seed", "5", "--rounds", "2"],
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t.wait_for_function("document.body.innerText.includes('Kids here (2)')", timeout=20000)
        t.click("button[aria-label='less Words per round']")
        t.wait_for_function("document.querySelectorAll('.stepper .val')[1].textContent === '4'")
        t.click("button[aria-label='less Words per round']")
        t.wait_for_function("document.querySelectorAll('.stepper .val')[1].textContent === '3'")
        t.click("button[data-level='easy']")
        t.wait_for_selector("button[data-level='easy'].chosen")
        t.evaluate("window.scrollTo(0, 0)")
        t.wait_for_timeout(600)
        t.screenshot(path=str(OUT / "dictation-dash-teacher-levels.png"))
        t.click("text=Start the race")

        # Round 1: Easy (faint outline).
        write_round(k, t, code, log, "easy", 1, shots={"writing": "dictation-dash-kid-easy.png", "cheer": "dictation-dash-kid-bean-jump.png"})
        log["easy_state"] = k.evaluate(STATE_JS, code)
        t.wait_for_selector("text=Winners!", timeout=120000)
        t.wait_for_timeout(1200)
        t.screenshot(path=str(OUT / "dictation-dash-winners-easy.png"))

        # Round 2: Hard (blank box). The teacher taps Hard, then Next round.
        # The done screen has no level buttons: change the level through the same API the lobby uses.
        seat = t.evaluate("(c) => JSON.parse(localStorage.getItem('dictation-dash:seat:' + c))", code)
        t.evaluate("""async ([c, s]) => (await fetch('/api/rooms/' + c + '/options', {method: 'POST', headers: {'content-type': 'application/json', 'x-player-id': s.playerId, 'x-player-secret': s.playerSecret}, body: JSON.stringify({level: 'hard'})})).status""", [code, seat])
        t.wait_for_timeout(1500)
        t.click("text=Next round")
        t.wait_for_function("!document.body.innerText.includes('Winners!')", timeout=20000)
        write_round(k, t, code, log, "hard", 2, fail_word=1,
                    shots={"writing": "dictation-dash-kid-hard.png", "board": "dictation-dash-board-live.png", "problem": "dictation-dash-kid-try-again.png"})
        log["hard_state"] = k.evaluate(STATE_JS, code)
        try:
            out, _ = agent.communicate(timeout=150)
        except subprocess.TimeoutExpired:
            agent.kill()
            out, _ = agent.communicate()
        log["agent_output"] = out.strip().splitlines()[-8:]
        t.wait_for_selector("text=Winners!", timeout=150000)
        t.wait_for_timeout(1500)
        t.screenshot(path=str(OUT / "dictation-dash-winners-hard.png"))
        k.wait_for_timeout(1500)
        log["kid_screen_end"] = k.inner_text("#app")[:220]
        log["board_end"] = t.inner_text(".board")
        log["kid_heard_clips"] = k.evaluate("window.__ddSaid || []")
        log["play_called"] = "stubbed: HTMLMediaElement.prototype.play and speechSynthesis.speak replaced before any page script"
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
