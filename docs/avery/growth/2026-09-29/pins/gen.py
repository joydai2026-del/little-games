import json, subprocess, os, html
pins = [
 dict(id="17739468", slug="01-halloween-mini-bundle", img="cat-20-halloween-chinese-mini-bundle.jpg", kicker="October Chinese class, done", title="Halloween Chinese Mini Bundle", zh="万圣节中文小套装", sub="Story + 田字格 writing + word activities in one $12 bundle", price="$12 bundle", bg="#F4D894", accent="#C85B73"),
 dict(id="17774630", slug="02-pumpkin-craft", img="cat-21-halloween-pumpkin-craft.jpg", kicker="Low-prep craft for K-5", title="Pumpkin Craft & Coloring in Chinese", zh="万圣节南瓜手工", sub="Color-by-character, roll-a-face game, and a word-wheel craft", price="$4.99", bg="#FBDCE3", accent="#C85B73"),
 dict(id="17597740", slug="03-free-halloween-vocab", img="cat-11-halloween-vocab-free.jpg", kicker="Free download", title="Halloween Chinese Vocab Flashcards", zh="万圣节词语卡", sub="Flashcards + worksheets for Mandarin immersion K-5", price="FREE", bg="#DEEFE4", accent="#42291D"),
 dict(id="17597005", slug="04-free-chinese-strokes", img="cat-13-free-chinese-strokes.jpg", kicker="Free download", title="Chinese Stroke Order Practice", zh="基本笔画 田字格", sub="Basic strokes worksheets for K-5 Chinese writers", price="FREE", bg="#DDEAF7", accent="#42291D"),
 dict(id="17733981", slug="05-halloween-story", img="cat-17-halloween-chinese-story.jpg", kicker="Read-aloud for immersion", title="Halloween Chinese Story Book", zh="万圣节小故事", sub="A simple Mandarin reader with K-5 vocabulary support", price="$4.99", bg="#FBEECB", accent="#C85B73"),
 dict(id="17734157", slug="06-halloween-activities", img="cat-19-halloween-chinese-activities.jpg", kicker="Centers + early finishers", title="Halloween Chinese Activities", zh="万圣节词语游戏", sub="Word games and worksheets for Mandarin K-5", price="$4.99", bg="#F6E9D8", accent="#C85B73"),
]
tpl = open('pin.tpl.html').read()
for p in pins:
    h = tpl
    for k,v in p.items(): h = h.replace('{{%s}}'%k, html.escape(v))
    f = p['slug']+'.html'; open(f,'w').write(h)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1','--window-size=1000,1500','--screenshot='+os.path.abspath(p['slug']+'.png'),'file://'+os.path.abspath(f)],check=True,capture_output=True)
    print('ok', p['slug'])
json.dump(pins, open('pins.json','w'), indent=1, ensure_ascii=False)
