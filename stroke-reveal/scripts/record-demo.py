#!/usr/bin/env python3
"""Live run on the REAL site, headless and silent (audio stubbed, Chromium muted).

A teacher makes a room with a real word list and projects the big screen; one
browser kid joins on a phone-sized screen and taps word cards with real clicks;
one AI agent joins through agent/play.mjs.

The browser kid is a SCRIPTED READER, not a person: it never looks at the
teacher's page. From its own phone seat it reads GET /drawing (the strokes on
the big screen, the same thing the class sees) and the public stroke data of
its own four cards, and taps the one card whose first strokes match, once at
least 2 strokes are up. On the second word it first taps a wrong card, to show
the K-2 pause. This proves the flow works end to end; it does not prove a
child can read the drawing.

  python3 scripts/record-demo.py            # stills + demo mp4 + gif
  python3 scripts/record-demo.py --no-video # stills only
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
LIST = "第三课\n1. 大人 dàrén grown-up\n2. 山 shān mountain\n3. 学校 xuéxiào school\n4. 人 rén person\n5. 火 huǒ fire\n6. 𠮷野 (rare, no data)"
READ_JS = """
async (code) => {
  const seat = JSON.parse(localStorage.getItem('stroke-reveal:seat:' + code));
  const headers = { 'x-player-id': seat.playerId, 'x-player-secret': seat.playerSecret };
  const d = await (await fetch('/api/rooms/' + code + '/drawing', { headers })).json();
  const cards = [...document.querySelectorAll('button.word-card')].map((b) => b.textContent);
  const data = await Promise.all(cards.map((w) => fetch('/api/strokes/' + encodeURIComponent([...w][0])).then((r) => (r.ok ? r.json() : null))));
  const matches = cards.map((_, i) => i).filter((i) => data[i] && (d.strokes || []).every((p, k) => data[i].strokes[k] === p));
  return { shown: d.shown || 0, question: d.question, cards, matches };
}
"""
MAX_GIF_BYTES = 8 * 1024 * 1024


def encode_demo(kid_webm, board_webm, log):
    """Side-by-side (phone left, big screen right) mp4 + gif under 8 MB."""
    ff = shutil.which("ffmpeg")
    if not ff:
        log["demo"] = "ffmpeg missing, no video"
        return
    mp4 = OUT / "stroke-reveal-demo.mp4"
    gif = OUT / "stroke-reveal-demo.gif"
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
    ap.add_argument("--url", default="https://stroke-reveal.joyd-ai-2026.workers.dev")
    ap.add_argument("--words", type=int, default=3, help="words per round")
    ap.add_argument("--no-video", action="store_true")
    args = ap.parse_args()
    record = not args.no_video
    raw = OUT / "_raw"
    base = args.url.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)
    log = {"url": base, "deployed_version": os.environ.get("STROKE_REVEAL_VERSION"), "deployed_commit": os.environ.get("STROKE_REVEAL_COMMIT"),
           "args": vars(args), "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "kid_taps": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--mute-audio"])
        rec_t = {"record_video_dir": str(raw / "board"), "record_video_size": {"width": 1100, "height": 900}} if record else {}
        rec_k = {"record_video_dir": str(raw / "kid"), "record_video_size": {"width": 390, "height": 844}} if record else {}
        teacher = browser.new_context(viewport={"width": 1100, "height": 900}, **rec_t)
        teacher.add_init_script(SILENT)
        kidctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, **rec_k)
        kidctx.add_init_script(SILENT)
        t = teacher.new_page()
        t.goto(f"{base}/#/")
        t.fill("textarea", LIST)
        t.click("text=Make a room")
        t.wait_for_selector(".roomcode")
        code = t.inner_text(".roomcode").strip()
        log["code"] = code
        log["teacher_notes"] = [n.inner_text() for n in t.query_selector_all(".notice")]
        # Words per round: step down from the default to --words.
        for _ in range(10):
            val = int(t.inner_text(".stepper .val"))
            if val <= args.words:
                break
            t.click("button[aria-label='less Words per round']")
            t.wait_for_function(f"document.querySelector('.stepper .val').textContent === '{val - 1}'", timeout=10000)

        k = kidctx.new_page()
        k.goto(f"{base}/#/join/{code}")
        k.fill("input[aria-label='Your name']", "Mia")
        k.click("text=Join the game")
        k.wait_for_selector("text=You're in")

        agent = subprocess.Popen(
            ["node", str(ROOT / "agent" / "play.mjs"), "--url", base, "--room", code, "--name", "Robo",
             "--patience", "0.7", "--mistakes", "0", "--seed", "5", "--poll-ms", "400"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t.wait_for_function("document.body.innerText.includes('Kids here (2)')", timeout=20000)
        t.evaluate("window.scrollTo(0, 0)")
        t.screenshot(path=str(OUT / "stroke-reveal-lobby.png"))
        t.click("text=Start the game")

        done_words = set()
        shots = set()
        deadline = time.time() + 180
        while time.time() < deadline:
            if t.query_selector("text=Winners!"):
                break
            buttons = k.query_selector_all("button.word-card")
            if not buttons or not any("open" in (b.get_attribute("class") or "") for b in buttons):
                k.wait_for_timeout(200)
                continue
            seen = k.evaluate(READ_JS, code)
            key = f"q{seen['question']}"
            if key in done_words or seen["shown"] < 2 or len(seen["matches"]) != 1:
                k.wait_for_timeout(250)
                continue
            if "live" not in shots:
                shots.add("live")
                t.screenshot(path=str(OUT / "stroke-reveal-board-live.png"))
                k.screenshot(path=str(OUT / "stroke-reveal-kid-cards.png"))
            right = seen["matches"][0]
            if seen["question"] == 1 and f"miss:{key}" not in done_words:
                done_words.add(f"miss:{key}")
                wrong = next(i for i in range(len(seen["cards"])) if i != right)
                log["kid_taps"].append({"word": seen["question"] + 1, "tapped": seen["cards"][wrong], "right": False, "strokes_seen": seen["shown"]})
                try:
                    buttons[wrong].click(timeout=3000)
                except Exception as e:  # a button that went away is a finding, not a crash
                    log.setdefault("click_errors", []).append(str(e)[:120])
                    continue
                k.wait_for_timeout(700)
                k.screenshot(path=str(OUT / "stroke-reveal-kid-try-again.png"))
                continue
            if "open" not in (buttons[right].get_attribute("class") or ""):
                k.wait_for_timeout(250)  # the K-2 pause after the wrong tap
                continue
            log["kid_taps"].append({"word": seen["question"] + 1, "tapped": seen["cards"][right], "right": True, "strokes_seen": seen["shown"]})
            try:
                buttons[right].click(timeout=3000)
            except Exception as e:
                log.setdefault("click_errors", []).append(str(e)[:120])
                continue
            done_words.add(key)
            k.wait_for_timeout(300)
            if "cheer" not in shots and k.query_selector(".cheer"):
                shots.add("cheer")
                k.screenshot(path=str(OUT / "stroke-reveal-kid-cheer.png"))
        t.wait_for_selector("text=Winners!", timeout=120000)
        t.wait_for_timeout(1500)
        t.screenshot(path=str(OUT / "stroke-reveal-winners.png"))
        try:
            out, _ = agent.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            agent.kill()
            out, _ = agent.communicate()
        log["agent_output"] = out.strip().splitlines()[-6:]
        log["board"] = t.inner_text("#app")[:400]
        k.wait_for_timeout(2500)
        log["kid_screen"] = k.inner_text("#app")[:200]
        kid_video = k.video.path() if record else None
        board_video = t.video.path() if record else None
        teacher.close()
        kidctx.close()
        browser.close()
        if record:
            encode_demo(kid_video, board_video, log)
    log["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(log, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
