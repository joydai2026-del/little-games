#!/usr/bin/env python3
"""Silent headless checks for the three Momo spikes. Re-run any time:  python3 check.py
Needs Python Playwright with Chromium (pip install playwright; playwright install chromium).
Writes check-receipt.txt next to this file and refreshes the PNGs in shots/.
Sound is never played: speechSynthesis.speak and HTMLMediaElement.play are stubbed before any page script runs."""
import datetime, os, re, shutil, subprocess, sys, tempfile, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE / "shots"; SHOTS.mkdir(exist_ok=True)
TMP = pathlib.Path(tempfile.mkdtemp(prefix="momo-check-"))
STUB = ("if(window.speechSynthesis){speechSynthesis.speak=function(){}};"
        "HTMLMediaElement.prototype.play=function(){return Promise.resolve()};")
FRUIT = "1. 苹果 píngguǒ apple\n2. 香蕉 xiāngjiāo banana\n3、西瓜 (xīguā) watermelon\n4) 葡萄 - pútao - grapes\n草莓, 橙子\n"
LONG = "一石二鸟\n生日快乐\n你好\n谢谢你\n对不起\n巧克力蛋糕\n"
PHONE = {"width": 390, "height": 844}; LAPTOP = {"width": 1280, "height": 800}
results = []
def check(name, ok, detail=""):
    results.append(("PASS" if ok else "FAIL", name, detail))
def url(f): return (HERE / f).as_uri()

# 1. Shared blocks must be identical in all three files
FILES = ["teach-momo.html", "karaoke-blanks.html", "comic-bubbles.html"]
def block(src, start, end):
    i = src.index(start); return src[i:src.index(end, i)]
srcs = {f: (HERE / f).read_text(encoding="utf-8") for f in FILES}
for label, a, b in [("shared JS (parser, helpers, icons)", "// ---- Shared helpers", "// ---- end shared helpers ----"),
                    ("shared CSS tokens", "/* ---- Shared look", ".momo .m-o,.momo .m-wavy{opacity:0}"),
                    ("Momo SVG markup", "<!-- MOMO SVG", "</svg>")]:
    blocks = {block(s, a, b) for s in srcs.values()}
    check("identical in all 3 files: " + label, len(blocks) == 1)
for f, s in srcs.items():
    body = re.sub(r":root\{[^}]*\}", "", s)
    check(f + ": no colour literals outside the :root tokens", not re.search(r"#[0-9A-Fa-f]{3,6}\b", body))
    check(f + ": no placeholder note on screen", "Momo drawing is a placeholder" not in s)

PARSER_CASES = [
    ("1. 苹果 píngguǒ apple", [["苹果", "píngguǒ"]]),
    ("苹果\tpíngguǒ\tapple", [["苹果", "píngguǒ"]]),
    ("香蕉, xiāngjiāo, banana", [["香蕉", "xiāngjiāo"]]),
    ("西瓜/xīguā", [["西瓜", "xīguā"]]),
    ("ping2guo3 苹果", [["苹果", "ping2guo3"]]),
    ("Q1 水果", [["水果", ""]]),
    ("mp3 音乐", [["音乐", ""]]),
    ("二〇二六", [["二〇二六", ""]]),
    ("葡萄\n葡萄 pútao", [["葡萄", "pútao"]]),
    ("草莓, 橙子", [["草莓", ""], ["橙子", ""]]),
    ("苹果 香蕉 píngguǒ xiāngjiāo", [["苹果", "píngguǒ"], ["香蕉", "xiāngjiāo"]]),
    ("hello world", []),
    ("<img src=x onerror=alert(1)> 苹果 </button><script>x</script>", [["苹果", ""]]),
]
errors, external = [], []
def watch(pg):
    pg.on("pageerror", lambda e: errors.append(f"{pg.url.rsplit('/',1)[-1]}: {e}"))
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{pg.url.rsplit('/',1)[-1]}: {m.text}"))
    pg.on("request", lambda r: (not r.url.startswith(("file:", "data:", "about:"))) and external.append(r.url))

def small_targets(pg, where):
    bad = pg.evaluate("""()=>[...document.querySelectorAll('button,textarea')].filter(b=>{const r=b.getBoundingClientRect();
        const cs=getComputedStyle(b);return r.width&&r.height&&cs.visibility!=='hidden'&&(r.width<63.5||r.height<63.5)})
        .map(b=>(b.textContent.trim()||b.tagName)+' '+Math.round(b.getBoundingClientRect().width)+'x'+Math.round(b.getBoundingClientRect().height))""")
    check("tap targets >= 64 px: " + where, not bad, "; ".join(bad))
    return not bad

def no_hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
def inside_view(pg, sel): return pg.evaluate(f"(()=>{{const r=document.querySelector('{sel}').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1}})()")
def pages(pdf):
    if shutil.which("pdfinfo"):
        out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
        return int(re.search(r"Pages:\s+(\d+)", out).group(1))
    return len(re.findall(rb"/Type\s*/Page[^s]", pdf.read_bytes()))

with sync_playwright() as p:
    br = p.chromium.launch()
    def page(vp):
        ctx = br.new_context(viewport=vp, device_scale_factor=2, is_mobile=vp["width"] < 600, has_touch=vp["width"] < 600)
        ctx.add_init_script(STUB); pg = ctx.new_page(); watch(pg); return pg

    # 2. Parser
    pg = page(PHONE); pg.goto(url("teach-momo.html"))
    for text, want in PARSER_CASES:
        got = [[w["zh"], w["py"]] for w in pg.evaluate("t=>parseList(t)", text)]
        check("parser: " + text.replace("\n", " / ").replace("\t", "<TAB>")[:48], got == want, f"got {got}")
    check("parser: 40 lines keeps 40 words", len(pg.evaluate("t=>parseList(t)", "\n".join(chr(0x4e00 + i) * 2 for i in range(40)))) == 40)

    # 3. Teach Momo
    small_targets(pg, "teach paste screen")
    pg.fill("#paste", FRUIT); pg.click("#start"); small_targets(pg, "teach word screen")
    pg.click("#act"); pg.click("#act")
    check("teach: first 'I said it!' makes Momo confused", pg.get_attribute("#momo", "data-mood") == "confused")
    pg.wait_for_timeout(1200); pg.screenshot(path=str(SHOTS / "teach-momo-confused.png"))
    pg.click("#act")
    check("teach: second 'I said it!' and Momo gets it, with pinyin", pg.get_attribute("#momo", "data-mood") == "gotit" and "píngguǒ" in pg.inner_text("#bubble"))
    check("teach: counter grammar '1 word'", pg.inner_text("#count") == "Momo learned 1 word", pg.inner_text("#count"))
    check("teach: primary button has an icon", pg.locator("#act svg.ic").count() == 1)
    pg.wait_for_timeout(1600); pg.screenshot(path=str(SHOTS / "teach-momo.png"))
    for _ in range(40):
        if pg.is_visible("#s-done"): break
        pg.click("#act")
    check("teach: end screen", pg.inner_text("#done-title") == "Momo learned all 6 words!", pg.inner_text("#done-title"))
    small_targets(pg, "teach end screen")
    for vp_name, vp in [("phone", PHONE), ("laptop", LAPTOP)]:
        q = page(vp); q.goto(url("teach-momo.html"))
        for w in ["巧克力蛋糕", "我今天很高兴见到你", "一石二鸟"]:
            q.click("#new-list") if q.is_visible("#new-list") else None
            q.fill("#paste", w); q.click("#start")
            check(f"teach {vp_name}: '{w}' fits, no sideways scroll", no_hscroll(q) and inside_view(q, "#word"))
            if w == "巧克力蛋糕" and vp_name == "phone": q.screenshot(path=str(SHOTS / "teach-long-word.png"))
        q.fill("#paste", "") if q.is_visible("#paste") else None
        q.click("#new-list"); q.fill("#paste", "水"); q.click("#start"); q.click("#act"); q.click("#act"); q.click("#act"); q.click("#act")
        check(f"teach {vp_name}: one-word grammar", q.inner_text("#done-title") == "Momo learned the word!", q.inner_text("#done-title"))
        q.context.close()

    # 4. Karaoke
    pg.goto(url("karaoke-blanks.html")); small_targets(pg, "karaoke paste screen")
    check("shared list remembered across files (Chromium, file://)", bool(pg.input_value("#paste")))
    pg.fill("#paste", FRUIT); pg.click("#go")
    chips = pg.eval_on_selector_all(".chip", "e=>e.map(x=>x.textContent+(x.classList.contains('blank')?'*':''))")
    check("karaoke: every 3rd word starts as a blank", chips == ["苹果", "香蕉", "西瓜*", "葡萄", "草莓", "橙子*"], str(chips))
    pg.click("[data-speed=fast]"); small_targets(pg, "karaoke setup screen")
    pg.screenshot(path=str(SHOTS / "karaoke-setup.png"), full_page=True)
    pg.click("#go"); pg.wait_for_timeout(600); pg.screenshot(path=str(SHOTS / "karaoke-singing.png"))
    pg.wait_for_selector("#stage.is-gap", timeout=6000); pg.wait_for_timeout(400)
    small_targets(pg, "karaoke blank screen"); pg.screenshot(path=str(SHOTS / "karaoke-blank.png"))
    check("karaoke: reveal button has an eye icon", pg.locator("#reveal svg.ic").count() == 1)
    pg.evaluate("()=>{const b=document.getElementById('reveal');b.click();b.click();b.click()}")   # three presses in one frame
    pg.wait_for_timeout(600); pg.screenshot(path=str(SHOTS / "karaoke-blanks.png"))
    pg.wait_for_timeout(1300)
    now = pg.evaluate("[...document.querySelectorAll('#strip span')].findIndex(s=>s.classList.contains('now'))")
    check("karaoke: triple press reveals once and moves one word", now == 3, f"now at word {now}, expected 3")
    pg.wait_for_selector("#stage.is-gap", timeout=8000); pg.click("#reveal")
    pg.wait_for_selector("#s-done.on", timeout=8000)
    check("karaoke: end screen", pg.inner_text("#done-sub") == "6 words, 2 shouted by the class.", pg.inner_text("#done-sub"))
    pg.click("#new-list")
    state = pg.evaluate("({more:document.getElementById('more').hidden,go:document.getElementById('go').textContent.trim(),chips:document.querySelectorAll('.chip').length,words:words.length})")
    check("karaoke: New list resets setup", state == {"more": True, "go": "Next", "chips": 0, "words": 0}, str(state))
    pg.fill("#paste", FRUIT); pg.click("#go"); pg.click("#go"); pg.wait_for_timeout(300); pg.click("#stop"); t0 = pg.evaluate("idx")
    pg.wait_for_timeout(2500); check("karaoke: Stop halts the song", pg.evaluate("idx") == t0)
    pg.fill("#paste", "苹果\n香蕉"); pg.click("#go")
    check("karaoke: too-short list gets a plain message", "at least 3" in pg.inner_text("#paste-note"))
    for vp_name, vp in [("phone", PHONE), ("laptop", LAPTOP)]:
        q = page(vp); q.goto(url("karaoke-blanks.html")); q.fill("#paste", LONG); q.click("#go")
        q.evaluate("()=>{blanks={}}")   # no blanks, so the long word is sung
        q.click("#go"); q.wait_for_function("document.querySelector('#kword').textContent==='巧克力蛋糕'", timeout=15000); q.wait_for_timeout(300)
        order = q.evaluate("[...document.querySelectorAll('#kword span')].map(s=>parseInt(s.style.getPropertyValue('--d')))")
        check(f"karaoke {vp_name}: 5-character word fits and sweeps in reading order", no_hscroll(q) and inside_view(q, "#kword") and order == sorted(order) and len(order) == 5, str(order))
        q.context.close()

    # 5. Comic
    for vp_name, vp in [("phone", PHONE), ("laptop", LAPTOP)]:
        q = page(vp); q.goto(url("comic-bubbles.html")); small_targets(q, f"comic {vp_name} paste screen")
        q.fill("#paste", LONG); q.click("#start")
        for _ in range(3):
            q.click("#shuffle"); q.wait_for_timeout(450)
            ov = q.evaluate("""()=>{const bad=[];document.querySelectorAll('.panel').forEach((p,pi)=>{const pr=p.getBoundingClientRect();
              const items=[...p.querySelectorAll('.bubble,.char')].map(e=>({e,r:e.getBoundingClientRect()}));
              items.forEach(a=>{if(a.r.left<pr.left-1||a.r.right>pr.right+1)bad.push('panel'+(pi+1)+' outside: '+a.e.textContent)});
              for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];
                const same=a.e.classList.contains('bubble')===b.e.classList.contains('bubble');
                const x=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left),y=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
                if(same&&x>0&&y>0)bad.push('panel'+(pi+1)+' overlap '+Math.round(x)+'px: '+a.e.textContent+' / '+b.e.textContent)}});return bad}""")
            if ov: break
        check(f"comic {vp_name}: 3-5 character words, no bubble or character overlaps (3 shuffles)", not ov, "; ".join(ov))
        check(f"comic {vp_name}: no sideways scroll", no_hscroll(q))
        small_targets(q, f"comic {vp_name} comic screen")
        if vp_name == "laptop": q.screenshot(path=str(SHOTS / "comic-laptop.png"), full_page=True)
        else: q.screenshot(path=str(SHOTS / "comic-long-words.png"), full_page=True)
        q.context.close()
    pg.goto(url("comic-bubbles.html"))
    pg.emulate_media(media="print")
    check("comic: printing before a comic exists shows 'Make the comic first'", pg.is_visible(".print-empty") and not pg.is_visible("main"))
    pg.pdf(path=str(TMP / "comic-empty.pdf"), prefer_css_page_size=True, print_background=True)
    check("comic: empty print is 1 page", pages(TMP / "comic-empty.pdf") == 1)
    pg.emulate_media(media="screen")
    pg.fill("#paste", "苹果\n香蕉"); pg.click("#start")
    check("comic: too-short list gets a plain message", "at least 3" in pg.inner_text("#paste-note"))
    many = "\n".join(chr(0x4e00 + i) * 2 for i in range(30))
    pg.fill("#paste", many); pg.click("#start")
    check("comic: long list warns first", "first 24" in pg.inner_text("#paste-note"))
    pg.click("#start"); check("comic: long list capped at 24 words", pg.locator("#tray button").count() == 24)
    pg.click("#new-list"); pg.fill("#paste", FRUIT); pg.click("#start")
    pg.click("#tray button:nth-child(1)"); pg.click("#tray button:nth-child(3)")
    pg.click(".bubble[data-b='4']", force=True); pg.click("#tray button:nth-child(6)"); pg.click(".bubble[data-b='2']", force=True)
    fills = pg.eval_on_selector_all(".bubble", "e=>e.map(x=>x.textContent)")
    check("comic: tap bubble then word fills it", fills == ["苹果", "西瓜", "tap me", "tap me", "橙子"], str(fills))
    pg.wait_for_timeout(600)
    pg.screenshot(path=str(SHOTS / "comic-bubbles.png"), full_page=True); pg.screenshot(path=str(SHOTS / "comic-bubbles-top.png"))
    pg.click("#shuffle"); pg.wait_for_timeout(450)
    check("comic: after Shuffle a bubble is highlighted", pg.locator(".bubble.sel").count() == 1)
    before = pg.eval_on_selector_all(".bubble", "e=>e.map(x=>x.textContent)")
    pg.click("#tray button:nth-child(2)")
    after = pg.eval_on_selector_all(".bubble", "e=>e.map(x=>x.textContent)")
    check("comic: after Shuffle a word tap changes the highlighted bubble only", after[0] == "香蕉" and after[1:] == before[1:], f"{before} -> {after}")
    check("comic: Shuffle and Print have icons", pg.locator("#shuffle svg.ic").count() == 1 and pg.locator("#print svg.ic").count() == 1)
    for size, name in [("letter", "letter"), ("A4", "a4")]:
        pg.click(f"[data-size={size}]"); pg.emulate_media(media="print")
        pdf = TMP / f"comic-{name}.pdf"; pg.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
        pg.emulate_media(media="screen")
        n = pages(pdf); check(f"comic: print on {size} is 1 page", n == 1, f"{n} pages")
        if shutil.which("pdftoppm"):
            subprocess.run(["pdftoppm", "-png", "-r", "80", "-singlefile", str(pdf), str(SHOTS / f"comic-print-{name}")], check=True)
    br.close()

check("no page or console errors", not errors, "; ".join(errors[:5]))
check("no requests outside the local files", not external, "; ".join(external[:5]))
n_fail = sum(1 for r in results if r[0] == "FAIL")
lines = [f"Momo spikes check receipt  {datetime.datetime.now().isoformat(timespec='seconds')}",
         f"Chromium headless via Python Playwright, viewports phone 390x844 and laptop 1280x800, sound stubbed",
         f"{len(results) - n_fail} PASS, {n_fail} FAIL", ""]
lines += [f"{s}  {n}" + (f"   [{d}]" if d and s == "FAIL" else "") for s, n, d in results]
(HERE / "check-receipt.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines)); sys.exit(1 if n_fail else 0)
