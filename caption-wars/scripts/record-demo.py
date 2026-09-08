#!/usr/bin/env python3
"""Records a real demo video of Caption Wars: a host creates a room with the
maximum AI players, starts the game, writes a real caption alongside the
bots, watches the round resolve, casts one vote per round to show the vote
screen working, and lets the game run to the final scores.

This drives the actual live UI with Playwright (no mocked API, no fixture
data) against the URL passed on the command line (default: the deployed
Worker). It is a tool, like scripts/ai-try.mjs, not part of the app itself.

Usage:
    python3 scripts/record-demo.py [URL] [--rounds N] [--out DIR]

Output (relative to --out, default docs/demo):
    caption-wars-raw.webm       - raw Playwright recording (kept for
                                   debugging; overwritten each run)
    caption-wars-demo.mp4       - ffmpeg re-encode, 1.5x speed, first
                                   second dropped
    caption-wars-demo.gif       - ffmpeg re-encode, 390px wide, 10fps,
                                   trimmed to fit under 8 MB
    still-01-lobby.png
    still-02-vote.png
    still-03-final.png
    events.json                  - phase-change log with timestamps

ffmpeg post-processing (mp4 + gif) runs as the last step of this script,
after the raw recording is finalized.
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

DEFAULT_URL = "https://caption-wars.joyd-ai-2026.workers.dev"
DEFAULT_ROUNDS = 3
HARD_CAP_SECONDS = 6 * 60
MAX_GIF_BYTES = 8 * 1024 * 1024

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "docs" / "demo"

# Plain, human-sounding one-liners that fit any photo. The host picks one
# per round (cycling through the list) so the demo doesn't look scripted
# with the same caption every time.
HOST_CAPTIONS = [
    "Same energy as my Monday",
    "Nobody asked, but here we are",
    "This is fine",
    "10/10, no notes",
    "The photo really said it all",
    "Not me relating to this",
]


def log(msg: str) -> None:
    print(f"[record-demo] {time.strftime('%H:%M:%S')} {msg}", flush=True)


def body_text(page: Page) -> str:
    try:
        return page.inner_text("body")
    except Exception:
        return ""


def find_binary(name: str) -> str:
    """Prefer the Homebrew path (matches this machine); fall back to PATH."""
    homebrew = Path("/opt/homebrew/bin") / name
    if homebrew.exists():
        return str(homebrew)
    found = shutil.which(name)
    return found if found else name


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    log(f"running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log(f"command failed (exit {result.returncode}): {result.stderr[-2000:]}")
        raise RuntimeError(f"command failed: {' '.join(cmd)}")
    return result


def ffprobe_duration(ffprobe_bin: str, path: Path) -> float:
    result = run(
        [
            ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ]
    )
    return float(result.stdout.strip())


def postprocess(raw_webm: Path, out_dir: Path, partial: bool = False) -> int:
    """Re-encodes the raw recording into the mp4 + gif deliverables. Runs as
    the final step of this script, since ffmpeg needs the finalized video
    file. Returns 0 on success, 1 if it could not run. `partial` only affects
    logging (labels the outputs as partial); it still encodes whatever
    footage exists so a human can inspect it."""
    if not raw_webm.exists():
        log(f"WARNING: no raw video at {raw_webm}, skipping ffmpeg post-processing")
        return 1

    if partial:
        log("NOTE: encoding a PARTIAL recording (the run did not complete cleanly)")

    ffmpeg_bin = find_binary("ffmpeg")
    ffprobe_bin = find_binary("ffprobe")

    mp4_path = out_dir / "caption-wars-demo.mp4"
    gif_path = out_dir / "caption-wars-demo.gif"

    log("encoding mp4 (H.264, yuv420p, 1.5x speed, first second dropped)")
    run(
        [
            ffmpeg_bin,
            "-y",
            "-i",
            str(raw_webm),
            "-ss",
            "1",
            "-filter:v",
            "setpts=PTS/1.5",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-crf",
            "23",
            str(mp4_path),
        ]
    )

    def make_gif(to_seconds: float | None) -> None:
        cmd = [ffmpeg_bin, "-y", "-i", str(raw_webm), "-ss", "1"]
        if to_seconds is not None:
            cmd += ["-to", str(to_seconds)]
        cmd += [
            "-filter_complex",
            "[0:v]fps=10,scale=390:-1:flags=lanczos,split[s0][s1];"
            "[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer",
            "-loop",
            "0",
            str(gif_path),
        ]
        run(cmd)

    log("encoding gif (390px wide, 10fps, palette) - trying the full run first")
    make_gif(None)
    gif_size = gif_path.stat().st_size

    if gif_size > MAX_GIF_BYTES:
        full_duration = ffprobe_duration(ffprobe_bin, raw_webm) - 1
        to_seconds = full_duration
        attempt = 0
        while gif_size > MAX_GIF_BYTES and attempt < 5 and to_seconds > 5:
            attempt += 1
            # Gif size scales roughly linearly with duration at fixed
            # fps/width; shrink proportionally with a small safety margin
            # and try again.
            to_seconds = max(5.0, to_seconds * (MAX_GIF_BYTES * 0.92 / gif_size))
            log(
                f"gif over 8 MB ({gif_size} bytes), retrying trimmed to "
                f"{to_seconds:.1f}s (attempt {attempt})"
            )
            make_gif(to_seconds)
            gif_size = gif_path.stat().st_size

    mp4_size = mp4_path.stat().st_size
    mp4_duration = ffprobe_duration(ffprobe_bin, mp4_path)
    gif_duration = ffprobe_duration(ffprobe_bin, gif_path)

    label = " [PARTIAL]" if partial else ""
    log(
        f"mp4{label}: {mp4_path} - {mp4_size / 1024 / 1024:.2f} MB, {mp4_duration:.1f}s"
    )
    log(
        f"gif{label}: {gif_path} - {gif_size / 1024 / 1024:.2f} MB, {gif_duration:.1f}s"
        + (" (over 8 MB!)" if gif_size > MAX_GIF_BYTES else "")
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Record a Caption Wars demo video.")
    parser.add_argument("url", nargs="?", default=DEFAULT_URL, help="Room URL (default: deployed Worker)")
    parser.add_argument("--rounds", type=int, default=DEFAULT_ROUNDS, help="Number of rounds (default: 3)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output directory (default: docs/demo)")
    args = parser.parse_args()

    url = args.url
    demo_dir = args.out
    video_dir = demo_dir / "_video_raw"
    demo_dir.mkdir(parents=True, exist_ok=True)
    video_dir.mkdir(parents=True, exist_ok=True)
    for old in video_dir.glob("*.webm"):
        old.unlink()

    # Remove any pre-existing raw recording before this run starts. Without
    # this, a run that fails to produce a new video could silently leave the
    # old raw_webm in place and this run would falsely look successful.
    raw_webm = demo_dir / "caption-wars-raw.webm"
    if raw_webm.exists():
        log(f"removing pre-existing raw recording: {raw_webm}")
        raw_webm.unlink()

    events: list[dict] = []
    start_time = time.time()
    reached_final = False
    failure_reason: str | None = None

    def record_event(name: str) -> None:
        t = round(time.time() - start_time, 1)
        events.append({"t": t, "event": name})
        log(f"event: {name} (t={t}s)")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            record_video_dir=str(video_dir),
            record_video_size={"width": 390, "height": 844},
        )
        page = context.new_page()
        video = page.video
        page.on("crash", lambda: log("PAGE CRASHED"))
        page.on("close", lambda: log("page closed"))
        page.on("console", lambda msg: log(f"console.{msg.type}: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda exc: log(f"pageerror: {exc}"))

        try:
            log(f"opening {url}")
            page.goto(url, wait_until="networkidle", timeout=30000)
            record_event("page loaded")

            page.wait_for_selector("#your-name", timeout=15000)
            page.fill("#your-name", "You")

            # Expand the settings <details> before touching the <select> options
            # inside it: Playwright's actionability check requires them visible,
            # and they are collapsed by default.
            page.click("details.settings summary")
            page.wait_for_selector("#opt-rounds", state="visible", timeout=5000)

            # Selectors and option values were read from the live DOM
            # (view-source on the deployed page), not guessed. Two notes vs the
            # brief: the caption-seconds field's real smallest option is 30
            # (the brief said the server minimum is 15, but 15 is not an
            # option in this select - it belongs to vote-seconds instead), and
            # vote-seconds' real smallest option is 15 (brief said 10). Using
            # the smallest option actually present in each <select>.
            page.select_option("#opt-rounds", str(args.rounds))
            page.select_option("#opt-caption-seconds", "30")
            page.select_option("#opt-vote-seconds", "15")
            page.select_option("#opt-bots", "4")
            record_event(
                f"settings configured (rounds={args.rounds}, caption=30s, vote=15s, bots=4)"
            )

            page.click("button:has-text('Create a room')")
            page.wait_for_selector("text=In the room", timeout=20000)
            page.wait_for_timeout(600)
            record_event("lobby reached")
            page.screenshot(path=str(demo_dir / "still-01-lobby.png"))
            log("saved still-01-lobby.png")

            page.click("button:has-text('Start the game')")
            record_event("clicked Start the game")

            vote_screenshot_taken = False
            voted_this_prompt = False
            captioned_this_prompt = False
            round_index = -1
            last_phase = None
            last_poll_log = 0.0

            while True:
                elapsed = time.time() - start_time
                if elapsed > HARD_CAP_SECONDS:
                    failure_reason = "hard cap (6 min) reached before the final results screen"
                    log(f"FAILURE: {failure_reason}; stopping loop and saving what we have")
                    record_event("hard cap reached")
                    break

                text = body_text(page)

                if "Play again" in text:
                    record_event("final results screen")
                    page.wait_for_timeout(1500)
                    page.screenshot(path=str(demo_dir / "still-03-final.png"))
                    log("saved still-03-final.png")
                    reached_final = True
                    break

                if "Write one caption" in text:
                    phase = "caption"
                    voted_this_prompt = False
                elif "Pick the best caption" in text:
                    phase = "vote-open"
                elif "Your pick is in" in text:
                    phase = "vote-done"
                elif "winner" in text.lower() or "No points" in text:
                    phase = "reveal"
                else:
                    phase = "other"

                if phase != last_phase:
                    record_event(f"phase -> {phase}")
                    last_phase = phase
                    if phase == "caption":
                        round_index += 1
                        captioned_this_prompt = False

                if phase == "caption" and not captioned_this_prompt:
                    # Type a real caption ~5s into the phase so the host isn't
                    # the straggler holding up the round: the server ends the
                    # caption phase as soon as every player (host + bots) has
                    # submitted, rather than waiting for the full timer.
                    page.wait_for_timeout(5000)
                    caption_text = HOST_CAPTIONS[round_index % len(HOST_CAPTIONS)]
                    try:
                        page.fill("#caption-text", caption_text)
                        page.click("button:has-text('Send')", timeout=2000)
                        record_event(f"host captioned: {caption_text!r}")
                    except Exception as exc:
                        log(f"caption submit failed (non-fatal): {exc}")
                    captioned_this_prompt = True

                if phase == "vote-open":
                    if not vote_screenshot_taken:
                        page.wait_for_timeout(300)
                        page.screenshot(path=str(demo_dir / "still-02-vote.png"))
                        log("saved still-02-vote.png")
                        vote_screenshot_taken = True
                    if not voted_this_prompt:
                        page.wait_for_timeout(3000)
                        cards = page.query_selector_all(
                            "button.vote-card:not(.vote-own):not([disabled])"
                        )
                        if cards:
                            try:
                                cards[0].click(timeout=2000)
                                record_event("cast a vote")
                            except Exception as exc:
                                log(f"vote click failed (non-fatal): {exc}")
                        voted_this_prompt = True

                if elapsed - last_poll_log > 15:
                    log(f"still running, elapsed={elapsed:.0f}s, phase={phase}")
                    last_poll_log = elapsed

                page.wait_for_timeout(800)

        except Exception as exc:
            failure_reason = f"UI error during flow: {exc}"
            record_event(f"error: {exc}")
            log(f"FAILURE: {failure_reason} (saving partial recording anyway)")
        finally:
            try:
                context.close()
            except Exception as exc:
                log(f"context.close() failed (browser likely already gone): {exc}")
            try:
                browser.close()
            except Exception as exc:
                log(f"browser.close() failed (already gone): {exc}")

        # Must resolve the video path while the Playwright event loop is still
        # alive (i.e. still inside this `with` block) - after it exits,
        # video.path() raises "Event loop is closed".
        video_path = None
        try:
            if video is not None:
                video_path = video.path()
        except Exception as exc:
            log(f"could not resolve video path: {exc}")

        if video_path and Path(video_path).exists():
            Path(video_path).replace(raw_webm)
            record_event(f"video saved: {raw_webm}")
            log(f"raw video saved to {raw_webm} ({raw_webm.stat().st_size} bytes)")
        else:
            log("WARNING: no video file produced")

    events_path = demo_dir / "events.json"
    events_path.write_text(json.dumps(events, indent=2))
    log(f"events log written to {events_path}")

    total = time.time() - start_time
    log(f"recording done, total wall time {total:.1f}s")

    # Success requires BOTH: the game actually reached the final results
    # screen in this run, AND a new raw webm was actually written by this
    # run (not a stale file left over from an earlier run - the leading
    # unlink() above guarantees that if this file exists now, this run
    # created it).
    video_written_this_run = raw_webm.exists()
    success = reached_final and video_written_this_run
    if not success and failure_reason is None:
        failure_reason = (
            "no recording was written this run"
            if not video_written_this_run
            else "did not reach the final results screen"
        )

    postprocess_status = postprocess(raw_webm, demo_dir, partial=not success)

    if not success:
        log(f"RESULT: FAILURE - {failure_reason}")
        return 1

    log("RESULT: SUCCESS - reached final results screen, raw recording written this run")
    return 0 if postprocess_status == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
