import json, html, os
OUT = '/workspace/avery-ops/growth-site/guides'
TPT = {
 'mini': ('Halloween Chinese Mini Bundle ($12)', 'https://www.teacherspayteachers.com/Product/Halloween-Chinese-Mini-Bundle-Story-Writing-Activities-K-5-17739468'),
 'pumpkin': ('Halloween Pumpkin Craft & Coloring ($4.99)', 'https://www.teacherspayteachers.com/Product/Halloween-Pumpkin-Craft-Coloring-Chinese-K-5-17774630'),
 'vocab': ('FREE Halloween Chinese Vocab flashcards and worksheets', 'https://www.teacherspayteachers.com/Product/FREE-Halloween-Chinese-Vocab-Flashcards-and-Worksheets-K-5-17597740'),
 'story': ('Halloween Chinese Story Book ($4.99)', 'https://www.teacherspayteachers.com/Product/Halloween-Chinese-Story-Book-K-5-Mandarin-17733981'),
 'writing': ('Halloween Chinese Writing 田字格 ($4.99)', 'https://www.teacherspayteachers.com/Product/Halloween-Chinese-Writing-K-5-Mandarin-17734062'),
 'acts': ('Halloween Chinese Activities ($4.99)', 'https://www.teacherspayteachers.com/Product/Halloween-Chinese-Activities-K-5-Mandarin-17734157'),
 'strokes': ('FREE Chinese Strokes Practice 田字格', 'https://www.teacherspayteachers.com/Product/FREE-Chinese-Strokes-Practice-Basic-Stroke-Order-Worksheets-K-5-17597005'),
 'radicals': ('FREE Chinese Radicals Practice Sampler', 'https://www.teacherspayteachers.com/Product/FREE-Chinese-Radicals-Practice-Sampler-Worksheets-K-5-17599684'),
 'bridge': ('Chinese Strokes to Radicals Bridge ($4.99)', 'https://www.teacherspayteachers.com/Product/Chinese-Strokes-to-Radicals-Bridge-Workbook-Stroke-Order-K-5-17682532'),
 'ws': ('Chinese Writing Study Book 5-Vol Bundle ($25)', 'https://www.teacherspayteachers.com/Product/Chinese-Writing-Study-Book-5-Vol-Bundle-Themes-K-5--17688687'),
}
def a(k):
    t,u = TPT[k]; return f'<a href="{u}" rel="noopener">{html.escape(t)}</a>'
MAILTO = ('mailto:avery.studio.business@gmail.com?subject=' +
  'Avery%20Games%20founding%20teacher%20waitlist&body=' +
  'Please%20add%20me%20to%20the%20Avery%20Games%20founding-teacher%20waitlist.%0A%0AName%3A%0AGrade(s)%3A%0ASchool%20or%20program%20(optional)%3A%0ASimplified%20or%20traditional%3A%0A')
WAITLIST = f'''<section class="waitlist" id="waitlist" aria-labelledby="wl-h">
  <h2 id="wl-h">Join the Avery Games founding-teacher waitlist</h2>
  <p>Avery Games is getting a teacher plan with level-sorted word sets, a new seasonal game every month tied to our printables, and a projector mode for whole-class play. Founding teachers get a locked-in launch discount and a free trial before anything is charged.</p>
  <p><a class="btn" href="{MAILTO}">Email me to join the waitlist</a></p>
  <p class="fine">Opens a pre-filled email to avery.studio.business@gmail.com. We only use your address to tell you about the Avery Games launch and founding-teacher pricing. Reply "unsubscribe" any time and you are off the list.</p>
</section>'''
CSS = '''<style>
:root{--paper:#FDF6EC;--card:#FFFCF6;--ink:#42291D;--ink-soft:#6B5142;--pink:#F4869C;--pink-deep:#C85B73;--pink-soft:#FBDCE3;--sage-soft:#DEEFE4;--butter-soft:#FBEECB}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:500 18px/1.6 Quicksand,"Noto Sans SC",system-ui,sans-serif}
main{max-width:780px;margin:0 auto;padding:28px 20px 60px}
.crumb{font-size:15px}.crumb a{color:var(--ink-soft)}
h1,h2,h3{font-family:"Baloo 2",Quicksand,sans-serif;line-height:1.15;color:var(--ink)}h1{font-size:40px;margin:.3em 0}h2{font-size:28px;margin-top:1.6em}h3{font-size:21px}
a{color:var(--pink-deep)}.lede{font-size:20px;color:var(--ink-soft)}
.answer{background:var(--card);border:3px solid var(--ink);border-radius:22px;padding:16px 20px}
table{border-collapse:collapse;width:100%;background:var(--card)}td,th{border:1px solid #e3d3c2;padding:8px 10px;text-align:left}th{background:var(--butter-soft)}
.zh{font-family:"Noto Sans SC",sans-serif}
.waitlist{margin-top:40px;background:var(--pink-soft);border:3px solid var(--ink);border-radius:26px;padding:20px 24px}
.btn{display:inline-block;background:var(--pink);color:var(--ink);font-weight:700;text-decoration:none;border:3px solid var(--ink);border-radius:999px;padding:10px 22px}
.fine{font-size:14px;color:var(--ink-soft)}
footer{margin-top:40px;font-size:15px;color:var(--ink-soft)}
details{background:var(--card);border-radius:14px;padding:10px 16px;margin:10px 0;border:1px solid #e3d3c2}summary{font-weight:700;cursor:pointer}
</style>'''
def page(slug, title, desc, h1, lede, answer, body, faqs, updated='2026-09-29'):
    url = f'https://averystudio.org/guides/{slug}' if slug else 'https://averystudio.org/guides'
    ld = [{"@context":"https://schema.org","@type":"Article","headline":h1,"description":desc,"datePublished":updated,"dateModified":updated,
           "author":{"@type":"Organization","name":"Avery Studio","url":"https://averystudio.org"},
           "publisher":{"@type":"Organization","name":"Avery Studio","url":"https://averystudio.org"},"mainEntityOfPage":url,"inLanguage":"en"}]
    if faqs:
        ld.append({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":html.unescape(__import__('re').sub('<[^>]+>','',ans))}} for q,ans in faqs]})
    faq_html = ''
    if faqs:
        faq_html = '<h2 id="faq">Frequently asked questions</h2>\n' + '\n'.join(f'<details><summary>{html.escape(q)}</summary><p>{ans}</p></details>' for q,ans in faqs)
    return f'''<!DOCTYPE html>
<!-- Avery Studio guide page (AEO/GEO). Static file under /guides, served on averystudio.org
     by the filesystem (no middleware rewrite needed). Canonical points at averystudio.org.
     House rule: never call Avery Games "free"; printables on TPT that are FREE may say so. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="canonical" href="{url}">
<link rel="icon" href="/assets/avery/momo-icon.png" type="image/png">
<meta property="og:type" content="article">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="{url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&family=Quicksand:wght@500;700&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet">
{CSS}
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
<main>
<p class="crumb"><a href="/">Avery Studio</a> &rsaquo; <a href="/guides">Guides</a></p>
<h1>{h1}</h1>
<p class="lede">{lede}</p>
<p class="fine">By Avery Studio, made by a veteran K-5 classroom teacher. Updated {updated}.</p>
{('<div class="answer"><p><b>Short answer:</b> ' + answer + '</p></div>') if answer else ''}
{body}
{faq_html}
{WAITLIST}
<footer>
<p>&copy; 2026 Avery Studio &middot; <a href="/">Home</a> &middot; <a href="/games">Avery Games</a> &middot; <a href="/guides">Guides</a> &middot; <a href="https://www.teacherspayteachers.com/store/avery-studio" rel="noopener">Avery Studio on TPT</a> &middot; <a href="/legal/policies.html">Policies</a></p>
</footer>
</main>
<script src="/assets/analytics.js" defer></script>
</body>
</html>
'''
pages = {}
# ---------- 1. Halloween
hw_vocab = [('万圣节','wànshèngjié','Halloween'),('南瓜','nánguā','pumpkin'),('南瓜灯','nánguā dēng','jack-o\'-lantern'),('糖果','tángguǒ','candy'),
 ('黑猫','hēi māo','black cat'),('蝙蝠','biānfú','bat'),('蜘蛛','zhīzhū','spider'),('女巫','nǚwū','witch'),('月亮','yuèliang','moon'),
 ('面具','miànjù','mask'),('眼睛','yǎnjing','eyes'),('嘴巴','zuǐba','mouth'),('不给糖就捣蛋','bù gěi táng jiù dǎodàn','trick or treat')]
rows = '\n'.join(f'<tr><td class="zh">{z}</td><td>{p}</td><td>{html.escape(e)}</td></tr>' for z,p,e in hw_vocab)
body = f'''
<h2>What makes a Halloween lesson work in a Chinese immersion classroom</h2>
<p>Immersion teachers need Halloween activities that keep the whole period in Mandarin, stay cute rather than scary for K-2, and still give grades 3-5 real reading and writing. The strongest plans combine three things: a short story read aloud in Chinese, a hands-on craft with word labels, and quick vocabulary games that recycle the same 8-12 words all week.</p>
<h2>Core Halloween vocabulary in Chinese (with pinyin)</h2>
<table><thead><tr><th>Chinese</th><th>Pinyin</th><th>English</th></tr></thead><tbody>
{rows}
</tbody></table>
<p class="fine">Simplified characters shown. Pick 6-8 words for K-1 and the full list for grades 2-5.</p>
<h2>A one-week plan (about 20 minutes a day)</h2>
<ol>
<li><b>Monday, meet the words.</b> Flashcards and a picture sort. The {a('vocab')} set covers this.</li>
<li><b>Tuesday, read the story.</b> Read aloud, then have students point to each vocabulary word. See the {a('story')}.</li>
<li><b>Wednesday, craft with labels.</b> Students color, cut, and label a pumpkin face (眼睛, 嘴巴, 南瓜). The {a('pumpkin')} includes a mystery color-by-character page, a roll-a-face game, and a word-wheel craft.</li>
<li><b>Thursday, write it.</b> 田字格 practice for 2-4 characters, stroke by stroke. See {a('writing')}.</li>
<li><b>Friday, play.</b> Paste the week's words into <a href="/games">Avery Games</a> and play a whole-class round on the projector, then partner games from the {a('acts')} pack.</li>
</ol>
<p>Everything above comes together in the {a('mini')}: story, writing, and activities for less than the three singles.</p>
<h2>Differentiating by grade</h2>
<ul>
<li><b>K-1:</b> listen-and-point, color-by-character with 3-4 characters, oral sentence frames like 我看见一个南瓜。</li>
<li><b>2-3:</b> label the craft, trace then write 南 瓜 糖 果, simple sentences with 有 and 是.</li>
<li><b>4-5:</b> retell the story, write a 3-sentence costume description, dictation of the week's words.</li>
</ul>
'''
faqs = [
 ('What are good Halloween activities for a Mandarin immersion class?','A Chinese read-aloud story, a pumpkin craft labeled with Chinese words, 田字格 writing practice, and quick vocabulary games. Keep K-2 content cute rather than scary.'),
 ('How do you say Halloween in Chinese?','万圣节 (wànshèngjié). Trick or treat is 不给糖就捣蛋 (bù gěi táng jiù dǎodàn).'),
 ('Is there a free Halloween Chinese vocabulary printable?',f'Yes. Avery Studio has a FREE Halloween Chinese Vocab set of flashcards and worksheets for K-5 on Teachers Pay Teachers: {TPT["vocab"][1]}'),
 ('How can I teach Halloween without scary content for young learners?','Focus on pumpkins, black cats, bats, the moon, masks, and candy. Skip ghosts and skeletons for K-1 if your school prefers, and frame the week around fall and harvest words.'),
 ('Can I use these with traditional characters?','The current Halloween printables use simplified characters. Avery Games lets you paste your own word list, so you can type traditional characters for game play.'),
]
pages['chinese-halloween-activities'] = page('chinese-halloween-activities',
 'Chinese Halloween Activities for Immersion Classrooms (K-5) | Avery Studio',
 'A teacher-made guide to Halloween in a Chinese immersion or Mandarin dual-language K-5 classroom: vocabulary with pinyin, a one-week plan, crafts, writing, and games.',
 'Chinese Halloween activities for immersion classrooms (K-5)',
 'A ready-to-run week of Halloween in Mandarin: vocabulary with pinyin, a read-aloud, a pumpkin craft, 田字格 writing, and classroom games.',
 'Teach 8-12 Halloween words (万圣节, 南瓜, 糖果, 黑猫, 蝙蝠...) across a story, a labeled craft, 田字格 writing, and a Friday game round. Keep it cute for K-2 and add retelling and dictation for grades 3-5.',
 body, faqs)
# ---------- 2. Vocab games
body = f'''
<h2>Why games matter in K-5 Chinese</h2>
<p>Young immersion students need many short, meaningful repetitions of the same words before they can read or write them. Games give you those repetitions without worksheets, and they work for mixed classes of heritage and non-heritage learners because every child hears and sees the target word dozens of times.</p>
<h2>Ten Chinese vocabulary games that work with any word list</h2>
<ol>
<li><b>Swat the word (拍一拍).</b> Tape word cards on the board; two students race to swat the word you say.</li>
<li><b>Whack-a-Word (打地鼠).</b> A word appears and students bop the mole holding it. Playable in <a href="/games">Avery Games</a>.</li>
<li><b>Echo Moles (听音打地鼠).</b> Same idea, but the word is spoken, not shown. Builds listening.</li>
<li><b>Memory match.</b> Match character to picture, or character to pinyin for older grades.</li>
<li><b>Stroke Reveal (猜猜我是谁).</b> A character is drawn one stroke at a time; the first student to guess wins more points the earlier they guess.</li>
<li><b>Missing Stroke (补一笔).</b> Show a character with one stroke missing and have students add it in the right place.</li>
<li><b>Trace Race (笔顺比赛).</b> Students race to trace a character in correct stroke order.</li>
<li><b>Dictation Dash (听写赛跑).</b> For grades 3-5: hear a word, write it from memory in a 田字格.</li>
<li><b>Roll and say.</b> Roll a die, say or read the word in that spot, and use it in a sentence frame.</li>
<li><b>Four corners.</b> Put a picture in each corner; say a word and students walk to the matching corner.</li>
</ol>
<h2>How to run a game in five minutes</h2>
<ol>
<li>Pick 6-10 words from this week's unit.</li>
<li>Paste them into <a href="/games">Avery Games</a>. Pinyin and an English gloss are filled in where missing, and you can edit them.</li>
<li>Show the class code on the projector. Students join on tablets with a code and a first name.</li>
<li>Play two short rounds, then switch to a paper follow-up such as {a('acts')} or {a('strokes')}.</li>
</ol>
<h2>Pair games with printables</h2>
<p>Games are the practice; printables are the take-home evidence. For stroke order, start with {a('strokes')} and {a('radicals')}, then move to the {a('bridge')} and the {a('ws')}. For October, the {a('mini')} includes a vocabulary activities pack that uses the same words as a Halloween game round.</p>
'''
faqs = [
 ('What are the best Chinese vocabulary games for kindergarten?','Short, physical, listening-first games: swat the word, four corners, Echo Moles, and picture memory match. Keep rounds under 5 minutes and use 6-8 words.'),
 ('How do I make a Chinese vocabulary game from my own word list?','Paste your list into Avery Games at averystudio.org/games. It fills in missing pinyin and English, you review them, then students join with a class code.'),
 ('Do students need accounts to play Avery Games?','No student accounts are needed today. Students join with a class code and a first name.'),
 ('Is there a trial for Avery Games?','Avery Games is in an early preview today. The upcoming teacher plan starts with a free trial; join the founding-teacher waitlist for launch pricing.'),
 ('Which games help with Chinese stroke order?','Trace Race, Missing Stroke, and Stroke Reveal all practice stroke order, and pair well with 田字格 worksheets.'),
]
pages['chinese-vocabulary-games-k5'] = page('chinese-vocabulary-games-k5',
 'Chinese Vocabulary Games for K-5 Immersion Classrooms | Avery Studio',
 'Ten Chinese vocabulary games for K-5 Mandarin immersion and dual-language classrooms, how to run them in five minutes with your own word list, and printable follow-ups.',
 'Chinese vocabulary games for K-5 classrooms',
 'Ten games that work with any Mandarin word list, how to run one in five minutes, and printable follow-ups for stroke order and writing.',
 'Use short listening-first games (swat the word, Echo Moles, four corners) for K-1, add stroke games (Trace Race, Missing Stroke, Stroke Reveal) for grades 1-3, and dictation races for grades 3-5. Paste your own list into Avery Games to play on tablets or the projector.',
 body, faqs)
# ---------- 3. FAQ
body = f'''
<h2>About Avery Studio</h2>
<p>Avery Studio makes Chinese (Mandarin) printables and classroom games for K-5 immersion, dual-language, heritage, and weekend Chinese school classes. Printables are sold on Teachers Pay Teachers and Gumroad; games are at <a href="/games">averystudio.org/games</a>.</p>
<h2>Where to start</h2>
<ul>
<li>New to our materials: {a('strokes')} and {a('vocab')}.</li>
<li>October: {a('mini')} or the {a('pumpkin')}.</li>
<li>Writing year-round: {a('bridge')}, then the {a('ws')}.</li>
</ul>
'''
faqs = [
 ('Where can I find Chinese immersion printables for K-5?','Teachers Pay Teachers has a large Chinese section. Avery Studio publishes K-5 Mandarin immersion packs there, including seasonal bundles, stroke-order and radicals worksheets, and story books.'),
 ('Do Avery Studio printables use simplified or traditional characters?','Current printables use simplified characters with pinyin where it helps young readers. Traditional versions are on the roadmap; tell us if you need them.'),
 ('Which grades are the materials for?','K-5. Most packs include easier pages for K-1 and writing or reading extensions for grades 3-5.'),
 ('Can I use the printables in a weekend Chinese school or at home?','Yes. They work for heritage-language weekend schools, homeschool, and parents supporting a child in a Mandarin immersion program. The standard TPT license covers one teacher or one family.'),
 ('Can a whole school or district buy a license?','For printables, TPT offers multi-license purchasing at checkout. For Avery Games, campus plans with invoice and purchase-order billing are planned; email avery.studio.business@gmail.com.'),
 ('What is Avery Games?','A set of Chinese classroom games (Vocab Games, 田字格 Writing Sheets, Trace Race, Stroke Reveal, Missing Stroke, Dictation Dash) that play from the teacher\'s own word list, with students joining by class code.'),
 ('How much will Avery Games cost?','A teacher plan with a free trial is coming. Founding teachers on the waitlist get a locked-in launch discount.'),
 ('Do the games align with Utah DLI or other curricula?','Games play from any word list you paste, so you can use your curriculum\'s unit words today. Level-sorted word sets are planned for the teacher plan.'),
]
pages['mandarin-immersion-teacher-faq'] = page('mandarin-immersion-teacher-faq',
 'Mandarin Immersion Teacher FAQ: Printables and Games for K-5 | Avery Studio',
 'Answers for Mandarin immersion, dual-language, and weekend Chinese school teachers: where to find K-5 Chinese printables, simplified vs traditional, licensing, and Avery Games.',
 'Mandarin immersion teacher FAQ',
 'Quick answers about Avery Studio printables and Avery Games for K-5 Chinese immersion, dual-language, and weekend-school teachers.',
 None, body, faqs)
# ---------- index
body = '''<ul>
<li><a href="/guides/chinese-halloween-activities">Chinese Halloween activities for immersion classrooms (K-5)</a></li>
<li><a href="/guides/chinese-vocabulary-games-k5">Chinese vocabulary games for K-5 classrooms</a></li>
<li><a href="/guides/mandarin-immersion-teacher-faq">Mandarin immersion teacher FAQ</a></li>
</ul>'''
pages['index'] = page('', 'Guides for Chinese Immersion Teachers | Avery Studio',
 'Teacher-made guides for K-5 Chinese immersion and Mandarin dual-language classrooms from Avery Studio.',
 'Guides for Chinese immersion teachers', 'Practical, teacher-made guides for K-5 Mandarin classrooms.', None, body, [])
for k,v in pages.items():
    open(os.path.join(OUT, k+'.html'),'w').write(v)
print('wrote', list(pages))
