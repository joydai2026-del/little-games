#!/usr/bin/env python3
"""Run the live checks against the deployed site and write a dated receipt.

Every A-grade live claim in the build report points at a line in this receipt.
Silent: the browser part opens ?silent=1 with speech and media stubbed.

Usage: python3 scripts/live-receipt.py [URL]
Writes docs/evidence/<today>-live-receipt.md
"""
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "https://tianzige-generator.joyd-ai-2026.workers.dev"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = json.load(open(os.path.join(ROOT, "src", "worker", "stroke-manifest.json"), encoding="utf-8"))["files"]
INK_CHECK = "/Users/joyd/Avery Studio Product Factory/scripts/hanzi/check_pdf_ink.py"
SHOW_HEADERS = ("content-type", "cache-control", "x-content-type-options", "content-security-policy", "retry-after")
lines: list[str] = []


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def req(method: str, path: str, body: bytes | None = None, headers: dict | None = None):
    # Cloudflare answers the default Python-urllib agent with 403 (error 1010), so name ourselves.
    h = {"User-Agent": "tianzige-live-receipt/1.0 (+https://github.com/joydai2026-del/little-games)", **(headers or {})}
    r = urllib.request.Request(URL + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def record(label: str, method: str, path: str, status: int, headers: dict, body: bytes, extra: str = "") -> None:
    shown = "; ".join(f"{k}: {headers[k]}" for k in SHOW_HEADERS if k in headers)
    sheet = "; ".join(f"{k}: {urllib.parse.unquote(v)}" for k, v in sorted(headers.items()) if k.startswith("x-sheet"))
    lines.append(f"| {now()} | {label} | `{method} {path}` | {status} | {len(body)} | {shown}{'; ' + sheet if sheet else ''} | {extra} |")


def strokes(char: str) -> None:
    path = "/api/strokes/" + urllib.parse.quote(char)
    status, h, body = req("GET", path)
    sha = hashlib.sha256(body).hexdigest()
    want = MANIFEST.get(char)
    match = "n/a" if want is None else ("MATCH" if sha == want else "MISMATCH")
    record(f"stroke proxy {char}", "GET", path, status, h, body, f"sha256 {sha[:16]}... manifest {match}" if status == 200 else body.decode()[:80])


def main() -> None:
    started = now()
    dep = subprocess.run(["npx", "wrangler", "deployments", "status"], cwd=ROOT, capture_output=True, text=True)
    lines.append("| time (UTC) | check | request | status | bytes | headers | result |")
    lines.append("|---|---|---|---|---|---|---|")

    s, h, b = req("GET", "/")
    record("app page", "GET", "/", s, h, b, "contains Paste box: " + str(b"Paste your characters here" in b))
    for c in ("大", "龍", "館", "學"):
        strokes(c)
    for bad in ("㐀", "大人", "a", "..%2F..%2Fpackage.json"):
        path = "/api/strokes/" + (bad if "%" in bad else urllib.parse.quote(bad))
        s, h, b = req("GET", path)
        record(f"proxy reject {bad}", "GET", path, s, h, b, b.decode()[:80])
    s, h, b = req("GET", "/licenses/ARPHICPL.TXT")
    repo = hashlib.sha256(open(os.path.join(ROOT, "public", "licenses", "ARPHICPL.TXT"), "rb").read()).hexdigest()
    record("license copy", "GET", "/licenses/ARPHICPL.TXT", s, h, b, f"sha256 {hashlib.sha256(b).hexdigest()[:16]}... repo copy {'MATCH' if hashlib.sha256(b).hexdigest() == repo else 'MISMATCH'}")

    j = {"Content-Type": "application/json"}
    body = json.dumps({"chars": "第三课 生字：校\n1. 大 dà big\n2. 学校 xuéxiào\n3. 龍 lóng, 㐀, ⼈", "options": {"paper": "a4", "grid": "mi"}}).encode()
    s, h, b = req("POST", "/api/sheet", body, j)
    record("agent sheet, messy paste", "POST", "/api/sheet", s, h, b, "ink-model cells: %d; <script: %d" % (b.count(b'class="ink-model"'), b.count(b"<script")))
    forty = "的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学"
    s, h, b = req("POST", "/api/sheet", json.dumps({"chars": forty}).encode(), j)
    record("agent sheet, 40+ characters", "POST", "/api/sheet", s, h, b, "")
    s, h, b = req("POST", "/api/sheet", json.dumps({"chars": "大"}).encode(), {"Content-Type": "text/plain"})
    record("wrong content type", "POST", "/api/sheet", s, h, b, b.decode()[:80])
    big = json.dumps({"chars": "大" * 20000}).encode()
    s, h, b = req("POST", "/api/sheet", big, j)
    record(f"oversized body ({len(big)} bytes)", "POST", "/api/sheet", s, h, b, b.decode()[:80])
    hostile = json.dumps({"chars": '</title><script>alert(1)</script> "><img src=x onerror=alert(1)> 大'}).encode()
    s, h, b = req("POST", "/api/sheet", hostile, j)
    record("hostile paste via API", "POST", "/api/sheet", s, h, b, f"<script: {b.count(b'<script')}; onerror: {b.count(b'onerror')}; <img: {b.count(b'<img')}")

    browser_lines = browser_checks()
    finished = now()

    out = os.path.join(ROOT, "docs", "evidence", f"{dt.date.today().isoformat()}-live-receipt.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"# Live receipt, {dt.date.today().isoformat()}\n\n")
        fh.write(f"Written by `scripts/live-receipt.py` against **{URL}**, {started} to {finished}.\n\n")
        fh.write("## Deployed version (`wrangler deployments status`)\n\n```\n" + (dep.stdout or dep.stderr).strip() + "\n```\n\n")
        fh.write("## HTTP checks\n\n" + "\n".join(lines) + "\n\n")
        fh.write("## Browser checks (Chromium, 390x844, live site)\n\n" + "\n".join(browser_lines) + "\n")
    print(out)


def browser_checks() -> list[str]:
    out: list[str] = []
    silence = "window.speechSynthesis&&(window.speechSynthesis.speak=()=>{});HTMLMediaElement.prototype.play=function(){return Promise.resolve()};"
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        ctx.add_init_script(silence)
        pg = ctx.new_page()
        pg.goto(URL + "/?silent=1", wait_until="networkidle")
        ready = "!document.querySelector('#print').disabled"

        # Tap targets.
        sizes = pg.evaluate("""() => [...document.querySelectorAll('.seg span, #print, .credits a')]
            .map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 12), Math.round(r.width), Math.round(r.height)]; })""")
        smallest = min(sizes, key=lambda x: min(x[1], x[2]))
        out.append(f"- {now()} tap targets: {len(sizes)} measured, smallest `{smallest[0]}` {smallest[1]}x{smallest[2]} px")

        # Missing character, PDF look-alike, heading, hostile markup.
        pg.fill("#chars", '第三课 生字：\n⼈ 大 㐀 <img src=x onerror=alert(1)>')
        pg.wait_for_function(ready, timeout=20000)
        pg.wait_for_timeout(300)
        out.append(f"- {now()} messy paste (heading, ⼈ U+2F08, 㐀, <img onerror>): Momo says \"{pg.inner_text('#momo-says')}\"; <img> in preview: {pg.eval_on_selector_all('#preview img', 'e => e.length')}")

        # Stale print: Print must be disabled from the first keystroke until the redraw lands.
        pg.fill("#chars", "大 小")
        pg.wait_for_function(ready, timeout=20000)
        pg.type("#chars", " 蛇", delay=0)
        disabled_now = pg.evaluate("document.querySelector('#print').disabled")
        pg.wait_for_function(ready, timeout=20000)
        out.append(f"- {now()} stale print guard: Print disabled right after a keystroke: {disabled_now}; enabled again after redraw: {pg.evaluate(ready)}")

        # Words stay together across page breaks, every paper and row width.
        # No character is shared between two items, so a page lookup by character is unambiguous.
        words = ["学校", "画蛇添足", "老师", "朋友", "一心一意", "春天"]
        paste = "大 小 山 水 火 木 " + " ".join(words)
        pg.fill("#chars", paste)
        pg.wait_for_function(ready, timeout=20000)
        splits, too_tall, pages_seen = [], [], []
        for paper in ("letter", "a4"):
            for per in ("6", "8", "10"):
                pg.locator(f"label:has(input[name=paper][value='{paper}']) span").click()
                pg.locator(f"label:has(input[name=perRow][value='{per}']) span").click()
                pg.wait_for_function(ready, timeout=20000)
                pg.wait_for_timeout(200)
                per_page = pg.evaluate("""() => [...document.querySelectorAll('#preview svg.sheet-page')].map(svg =>
                    [...svg.querySelectorAll('g.ink-model use')].map(u => String.fromCodePoint(parseInt(u.getAttribute('href').split('-c')[1], 16))))""")
                pages_seen.append(f"{paper}/{per}: {len(per_page)} pages")
                for w in words:
                    where = {i for i, chars in enumerate(per_page) for c in set(w) if c in chars}
                    if len(where) > 1:
                        first = min(where)
                        # Moved to a fresh page and still did not fit: taller than one page, split allowed.
                        if per_page[first] and per_page[first][0] == w[0]:
                            too_tall.append(f"{w} ({paper}/{per}, starts page {first + 1})")
                        else:
                            splits.append(f"{w} on pages {sorted(where)} ({paper}/{per})")
        out.append(f"- {now()} words across page breaks, paste `{paste}`: {', '.join(pages_seen)}; words split that would fit on one page: {splits or 'none'}; words taller than a page (starting a fresh page, split between characters by design): {too_tall or 'none'}")

        # Print Letter and A4 and check the vectors.
        pg.locator("label:has(input[name=perRow][value='8']) span").click()
        for paper in ("letter", "a4"):
            pg.locator(f"label:has(input[name=paper][value='{paper}']) span").click()
            pg.wait_for_function(ready, timeout=20000)
            pg.wait_for_timeout(300)
            with tempfile.TemporaryDirectory() as tmp:
                pdf = os.path.join(tmp, f"{paper}.pdf")
                pg.pdf(path=pdf, prefer_css_page_size=True, print_background=True)
                info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
                size = next((l.split(":", 1)[1].strip() for l in info.splitlines() if l.startswith("Page size")), "?")
                pages = next((l.split(":", 1)[1].strip() for l in info.splitlines() if l.startswith("Pages")), "?")
                ink = subprocess.run([sys.executable, INK_CHECK, pdf], capture_output=True, text=True)
                text = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True).stdout
                latin = sorted({w for w in text.split() if any("a" <= ch.lower() <= "z" for ch in w)})
                out.append(f"- {now()} printed {paper}: {pages} pages, {size}; check_pdf_ink: `{ink.stdout.strip().splitlines()[-1] if ink.stdout.strip() else ink.stderr.strip()}` (exit {ink.returncode}); Latin words on the page: {latin}")
        b.close()
    return out


if __name__ == "__main__":
    main()
