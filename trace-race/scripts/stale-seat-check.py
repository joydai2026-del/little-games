#!/usr/bin/env python3
"""Live check: a phone holding a stale seat for a room code gets back to the join form.

Plants a seat with a wrong secret for a real, live room, opens the teacher's join link
(#/join/CODE), expects "This room has ended.", taps "Join again", and expects the join
form with the code filled in. Headless, silent. Prints JSON.
  python3 scripts/stale-seat-check.py [--url ...]
"""
import argparse, json
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="https://trace-race.averystudio.org")
base = ap.parse_args().url.rstrip("/")
out = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, args=["--mute-audio"])
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script("HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; window.speechSynthesis && (window.speechSynthesis.speak = () => {});")
    p = ctx.new_page()
    p.goto(f"{base}/?silent=1#/")
    # A real, live room made from the page itself (a teacher elsewhere); this phone has no seat in it.
    code = p.evaluate("async () => (await (await fetch('/api/rooms', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: '人 口'})})).json()).code")
    out["code"] = code
    p.evaluate("([c]) => localStorage.setItem('trace-race:seat:' + c, JSON.stringify({playerId: 'stale', playerSecret: 'stale'}))", [code])
    p.goto(f"{base}/?silent=1#/join/{code}")
    p.wait_for_selector("text=This room has ended.", timeout=15000)
    out["ended_screen"] = True
    out["hash_before_click"] = p.evaluate("location.hash")
    p.click("text=Join again")
    p.wait_for_selector("input[aria-label='Room code']", timeout=10000)
    out["join_form_shown"] = True
    out["code_prefilled"] = p.input_value("input[aria-label='Room code']")
    out["seat_cleared"] = p.evaluate("([c]) => localStorage.getItem('trace-race:seat:' + c) === null", [code])
    b.close()
out["pass"] = out.get("join_form_shown") and out.get("code_prefilled") == code and out.get("seat_cleared")
print(json.dumps(out, indent=2))
