# Avery Games: inventory, seasonal word packs, and new game ideas (2026-09-30)

Owner: JD · Prepared for builds with Fable in Claude Code on parallel `feat/` branches.
House rules that apply to everything below: `little-games/CLAUDE.md` (plain-English teacher UI, phone-first, agent-native HTTP API, no student accounts, config not literals, live-recorded demo, never work on `main`). **The games are being monetized. Never call them "free" in UI, READMEs, listings or copy.** Use "Starter", "trial" or just describe what the game does.

---

## 1. Inventory: what exists today

Checked against `origin/main` of `joydai2026-del/little-games`, the private `joydai2026-del/bilingual-vocab-game` README, and the live page https://www.averystudio.org/games (fetched 2026-09-30 9:30 AM ET).

| # | Game / tool | Where the code lives | Live URL | What it does | Grade | Players | Notes |
|---|---|---|---|---|---|---|---|
| 1 | **Vocab Games** (Vocab Game Generator) | `bilingual-vocab-game` (private; public mirror `bilingual-vocab-game-public`) | bilingual-vocab-game.joyd-ai-2026.workers.dev (linked from /games) | Teacher pastes a list; app fills pinyin + English gloss for review; 7 modes: Memory Match, Race Quiz, Cloud Climb, Treasure Dash, 听一听 Sound Sprint, 打地鼠 Whack-a-Word, 听音打地鼠 Echo Moles | K-5 (little/big kid settings) | Solo + rooms (some modes solo only) | LLM only fills glosses; games are hand-written templates. Echo Moles marked "Paid later" in config |
| 2 | **Trace Race 笔顺比赛** | `little-games/trace-race` | trace-race.averystudio.org | Kids race to trace characters stroke by stroke in the right order on phones; teacher screen is a race board | K-5 | Class room (4-letter code) | Funnel to FREE strokes → Bridge printables |
| 3 | **猜猜我是谁 Stroke Reveal** | `little-games/stroke-reveal` | stroke-reveal.averystudio.org | Momo draws a character stroke by stroke on the big screen; first kid to tap the right word card wins; earlier = more points | K-5 (class level picker) | Class room | Big-screen + phones |
| 4 | **补一笔 Missing Stroke** | `little-games/missing-stroke` | missing-stroke.averystudio.org | Character shown with one stroke missing; kids draw it in the right spot | K-5 | Solo ("Play by myself") or class room | Only game with a real solo mode besides Vocab Games |
| 5 | **Dictation Dash 听写赛跑** | `little-games/dictation-dash` | dictation-dash.averystudio.org | Momo says a word (Workers AI TTS), kids write it from memory stroke by stroke; Easy (faint outline) / Hard (blank box) | 3-5 | Class room | Marked `PRODUCT.paidLater`; TTS clips cost model calls |
| 6 | **田字格 Writing Sheets** (Tianzige Generator) | `little-games/tianzige-generator` | tianzige.averystudio.org | Paste characters (messy OK) → printable stroke-order 田字格/米字格 sheet; `POST /api/sheet` for agents | K-5 teachers | Teacher tool | Already the "printables from any list" engine the strategy needs |
| 7 | **Caption Wars** | `little-games/caption-wars` | caption-wars.joyd-ai-2026.workers.dev | Photo drops, everyone captions, everyone votes; AI players join | Adults/party (not a classroom product yet) | Rooms + AI bots | Not on /games. Its room + vote engine is reusable for Draw & Guess (idea N3) |
| 8 | **avery-hub** (infrastructure) | `joydai2026-del/avery-hub` (private) | — | Teacher Google sign-in, sessions, D1, "is she subscribed?" gate via `HubService` RPC; kids never sign in | — | — | Plan in little-games PR #18 (draft); house-rule change in PR #24 (draft) |

**Planned but not built** (from `docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md` and `TEACHER-GAMES-IDEAS-2026-09-28.md`): List Lab, Parent Night Lite (home link), Randomizer+, Sub Plan Generator, Progress postcard, Teach Momo / perform modes, Sentence Builder, Pair Interview, festival skins, projector/whole-class mode, simplified/traditional + pinyin toggles, level-sorted word sets.

**Gaps the inventory shows**
- Every game is **word-list-in, game-out**, which is the right core. But the teacher has to bring the list. Nothing ships *with* content yet: no seasonal lists, no level-sorted sets. That's the cheapest thing to fix and the retention hook promised on /games ("a new seasonal game each month tied to our printables").
- Almost everything needs **one device per kid**. K-1 rooms often have none. Projector-only play is the #1 conversion item in the teacher review (GAMES-SUBSCRIPTION-LAUNCH-PLAN §2).
- No game makes kids **speak or move**. The north star ("kids perform Chinese") isn't served yet by anything beyond tapping and tracing.
- No game touches **radicals / 部首** even though "chinese radicals" and "chinese stroke" are live TPT search terms for Avery and the FREE radicals sampler is a funnel SKU.

---

## 2. Seasonal reskins and word packs tied to TPT products

### 2a. The mechanism (build once, then every season is content)
A **Word Pack** is a JSON file: `id`, season, grade band, simplified list (+ optional traditional), pinyin with tone marks, English gloss (teacher-only), picture key from the product's art bank, a **skin** (Momo costume PNG, background, 2 accent colors, sticker for correct answers), and a **Pair-with** block (TPT product ID, title, price, URL). Every engine reads `?pack=<id>` and preloads the list, or the teacher picks from a "Seasonal lists" shelf. Skins change only paint and Momo, never game logic (house rule: festival skins are content packs on existing engines, not new codebases).

- Ships in: the six little-games engines + Vocab Games (separate private repo, same JSON contract).
- Paywall fit: the current season's pack is visible to everyone as a teaser round; the full shelf (all seasons, level-sorted) is a Teacher-plan feature. Word it as "Teacher plan" / "Starter", never "free".
- Funnel both ways: the pack's 课堂游戏 page in the PDF (Style Standard H3) prints the same list and a QR that opens `?pack=<id>`; the game's end screen shows "Print this week's practice" → the paired TPT SKU.

### 2b. The packs (vocab pulled from the actual TPT products and pipeline builds)

| Pack | Window (on shelf → retire) | Word list (simplified; pinyin added in the JSON) | Paired TPT products | Skin | Best engines |
|---|---|---|---|---|---|
| **万圣节 Halloween** | now → Nov 1 | 南瓜 月亮 黑猫 糖果 蝙蝠 幽灵 眼睛 嘴巴 鼻子 万圣节 翅膀 山洞 | Halloween Mini Bundle #17739468 ($12), Pumpkin Craft #17774630 ($4.99), Bat Craft #17793964 ($4.99), FREE Halloween Vocab #17597740 | Momo in a pumpkin hat; night-purple board; moles become pumpkins in Whack-a-Word | Whack-a-Word ("打南瓜"), Stroke Reveal, Missing Stroke, Trace Race |
| **秋天 Autumn** | Oct 5 → Nov 25 | 秋天 树叶 松鼠 松果 篮子 小兔子 大风 树洞 苹果 稻草人 大雁 | 秋天来了 Activity Pack, 小松鼠的秋天 Reader (both in review; planned $4.99 each), Fall Bundle (~Nov 10) | Falling-leaf background; Momo with a scarf; squirrel "helper" sticker | Cloud Climb (leaves), Memory Match, Sound Sprint, Stroke Reveal |
| **感恩节 Thanksgiving** | Nov 1 → Nov 30 | 感恩节 火鸡 羽毛 谢谢 感谢 大餐 玉米 土豆 面包 南瓜派 家人 朋友 | Thanksgiving Turkey Gratitude Craft (live ~Nov 5), existing gratitude vocab pack ($4.99), Fall Bundle | Momo holding a turkey feather; each correct answer adds a feather to a class turkey | Race Quiz, Treasure Dash, Dictation Dash (3-5: 我感谢…) |
| **冬天 Winter** | Nov 20 → Feb 28 | 冬天 雪人 下雪 冷 围巾 帽子 手套 外套 靴子 天气 晴天 刮风 | 冬天来了 Winter Unit (live ~Nov 17-24), Winter Bundle | Snow globe board; Momo in mittens; build-a-snowman progress meter | Trace Race, Missing Stroke, Echo Moles |
| **冬季节日·新年 Winter holidays** | Dec 1 → Jan 3 | 礼物 新年 贺卡 饺子 灯 蛋糕 烟花 倒数 家人 快乐 | 冬季节日·新年 pack (live ~Dec 1-5), Winter Bundle | Gift-box moles; countdown-chain progress bar (10 links = 10 rounds) | Whack-a-Word, Stroke Reveal |
| **春节 羊年 Lunar New Year 2027** | Jan 2 → Feb 21 | 春节 除夕 红包 春联 灯笼 饺子 烟花 舞龙 舞狮 年糕 汤圆 福 拜年 团圆饭 羊 | 春节 羊年 mega pack ($9.99, live Jan 5-8), 红包+福 mini ($3.99), FREE 羊年 coloring (Dec 28), Winter Bundle upgrade | Red/gold; Momo in a 羊 hat; 红包 chests in Treasure Dash; lanterns light up per correct answer | Treasure Dash (红包), Stroke Reveal, Trace Race (福 upside-down bonus), all others |
| (bonus) **元宵节 Lantern riddles** | Feb 7 → Feb 21 | 灯笼 汤圆 猜灯谜 月亮 圆 + teacher's own | 春节 mega pack p7 riddle cards | Lantern board | Draw & Guess (N3) as 猜灯谜 |

Year-2 note: the zodiac changes every year (2027 = 羊). Keep the animal as one config field so 2028 is a one-line change. Mid-Autumn (next Sept) is the obvious 8th pack; it's Avery's #1 TPT search term.

### 2c. Kickoff prompts (Claude Code / Fable)

**Prompt S0: Word Pack system (do this first; every season depends on it)**
```
You are working in joydai2026-del/little-games. Read CLAUDE.md, docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md and docs/avery/brand/AVERY-BRAND-GUIDE.md first.
Branch: feat/word-packs-core (from origin/main). Never commit to main.
Goal: a shared "Word Pack" contract that every Avery game can preload with ?pack=<id>.
1. Add packages/avery-packs/ (or shared/avery-packs/ if the repo has no packages dir) with: schema.ts (zod or plain TS types: id, season, gradeBand, words[{hanzi, hanziTrad?, pinyin (tone marks), glossEn (teacher-only), picture?}], skin{momoPng, bg, accent1, accent2, correctSticker}, pairWith[{tptId, title, priceUsd, url}], activeFrom, activeTo), a validator, and packs/halloween-2026.json with: 南瓜 月亮 黑猫 糖果 蝙蝠 幽灵 眼睛 嘴巴 鼻子 万圣节 翅膀 山洞. Verify pinyin with the repo's existing pinyin source, not by hand.
2. Wire ONE engine end to end: trace-race. ?pack=halloween-2026 preloads the list on the teacher screen (teacher can still edit), applies the skin tokens, and shows a "Print this week's practice" card on the winners screen linking the pairWith product. All pack/skin values are config, never literals in game logic.
3. Add GET /api/packs and GET /api/packs/:id so AI agents can discover packs (agent-native rule).
4. vitest: schema validation, every pack's hanzi has stroke data, pinyin has tone marks, dates are valid, no pack copy contains the word "free" or "免费".
5. Record the demo on the LIVE deploy with trace-race/scripts (update README three ways per CLAUDE.md).
Copy rules: never describe the games as free; kid-facing screens Chinese-first; teacher screens plain English.
Stop and open a PR with a short report; do not merge. Codex reviews before JD.
```

**Prompt S1: Halloween skin across the other engines (parallel, one branch per engine)**
```
Repo joydai2026-del/little-games. Prereq: feat/word-packs-core is merged (read packages/avery-packs/). Branch: feat/<game>-halloween-skin where <game> is one of stroke-reveal | missing-stroke | dictation-dash | tianzige-generator.
Touch ONLY your game's folder plus one line in the root README if needed (to avoid merge conflicts with the other parallel branches).
Add ?pack=<id> preload + skin tokens + the "Print this week's practice" pairWith card on the results screen. Halloween skin: Momo in the pumpkin-hat PNG (ask JD for the asset path if it doesn't exist; do not generate off-brand art), night-purple board. Game logic unchanged.
Tests: pack loads, teacher can still edit the list, skin falls back cleanly when no pack is given. Re-record the live demo. Open a PR; never call the game free.
```

**Prompt S2: Vocab Games pack loader (private repo)**
```
Repo joydai2026-del/bilingual-vocab-game. Branch feat/vocab-word-packs. Read the README contract ("the games are templates, not generated code").
Import the Word Pack JSON contract from little-games packages/avery-packs (copy the schema file with a header comment naming the source commit; do not add a cross-repo build dependency).
Add a "Seasonal lists" shelf on the set page and ?pack=<id>. Whack-a-Word gets a per-pack mole sprite (Halloween: pumpkins). Treasure Dash gets per-pack chest art (春节: 红包). Keep the LLM out of gameplay; the pack already has glosses so /api/enrich is skipped when a pack is loaded.
Tests + live demo recording as the repo requires. PR only.
```

**Prompt S3: each new season (content-only PR, 30-60 min each)**
```
Repo joydai2026-del/little-games, branch feat/pack-<season>-<year> (e.g. feat/pack-autumn-2026).
Add packages/avery-packs/packs/<season>-<year>.json using this word list: <paste from GAMES-IDEAS §2b>, gradeBand <K-2|3-5|K-5>, pairWith <TPT ids from the table>, activeFrom/activeTo <dates>. Add skin assets under avery-brand/ only if JD supplied them. Run the pack validator + vitest. Screenshot each engine with the pack loaded (live preview URL) into docs/packs/<season>/. PR only. Never write "free".
```

---

## 3. New game ideas for K-5 Chinese classrooms (ranked)

Scoring: **Effort** S = 2-4 build days, M = 5-8, L = 9+ (one Fable/Claude Code builder, including tests, Codex review and live demo). **Impact** = likely effect on Teacher-plan conversion and retention, judged against the teacher-review asks (projector mode, level-sorted sets, K-1 without devices, DLI word of mouth) and Avery's TPT demand (stroke, radicals, seasonal).

| Rank | Idea | Effort | Impact | Why this rank |
|---:|---|:--:|:--:|---|
| 1 | **N1 宾果 Bingo Night** (projector caller + printable boards from any list) | S | High | Every Avery seasonal pack already has bingo; teachers know the game; one screen, zero kid devices; prints = bridge to TPT |
| 2 | **N2 墨墨说 Momo Says** (projector TPR / Simon Says) | S | High | K-1 with no devices; kids move and speak; directly serves the north star |
| 3 | **N3 你画我猜 Draw & Guess** | M | High | Highest student energy; reuses the Caption Wars room + vote engine; works as 猜灯谜 for 元宵 |
| 4 | **N4 部首拼拼乐 Radical Builder** | M | High | Unique vs every competitor; matches "chinese radicals" search demand and the FREE radicals → Writing Study funnel |
| 5 | **N5 找一找 Write-the-Room QR Hunt** | M | Med-High | Teachers already buy write-the-room printables; gets kids out of seats; needs only 3-5 shared devices |
| 6 | **N6 句子火车 Sentence Train** | M | Medium | Moves beyond single words (a 2-5 gap); uses the sentence frames already in every pack |
| 7 | **N7 我是小老师 Teach Momo** (speaking, teacher-judged) | M | Medium | Speaking practice with no unreliable child speech scoring; audio never stored |
| 8 | **N8 飞行棋 Class Board Game** (projector board with dice, teams) | M | Medium | Digital twin of the board games in every pack (蝙蝠回山洞, 去吃大餐, 拜年去); strong seasonal reskin surface |

### N1. 宾果 Bingo Night
**Spec.** The teacher pastes a list (or picks a Word Pack). The tool makes (a) 30 unique printable bingo boards (3×3 for K-1, 4×4 for 2-3, 5×5 for 4-5) with a Momo center square, as a PDF from the Tianzige print pipeline, and (b) a projector **caller** screen. The caller draws a word, shows a picture (K-1) or only the characters (3-5) or only plays the audio (listening mode, reusing Dictation Dash TTS cache), and keeps a called-words board so the teacher can check a 宾果 claim in one tap. No kid devices, no accounts. Optional: kids on devices get a digital board that auto-marks (a class room like the other games). Config: board size, call speed, show pinyin on/off, simplified/traditional. It's the fastest bridge between printables and games: a teacher who already bought an Avery pack sees the same words, same art, same 宾果 moment on the big screen.

```
Repo joydai2026-del/little-games. Read CLAUDE.md and docs/avery/AVERY-CLASSROOM-GAMES-PICKUP.md. Branch: feat/bingo-night. New folder bingo-night/ with the same stack as missing-stroke (one Cloudflare Worker + static assets + a Durable Object per room, vitest).
Build 宾果 Bingo Night:
1. Teacher screen (plain English): paste words (reuse the character/word parser from stroke-reveal so pinyin, numbers and headings are skipped and reported), or ?pack=<id> if packages/avery-packs exists. Pick grade band: K-1 (3x3, pictures when the pack has them), 2-3 (4x4), 4-5 (5x5).
2. "Print boards": N unique boards (default 30, config) as a Letter PDF, 楷体/LXGW WenKai for characters, Momo center square, 姓名 line, no English on the student board (Avery Style Standard H1). Reuse tianzige-generator's print approach; no emoji.
3. "Call on the big screen": projector caller with big character, optional picture, optional audio (reuse dictation-dash's TTS + cache path; audio off by default), called-words grid, Undo, and "Check a board" (teacher taps the words a kid claims and it says 宾果 or not yet).
4. Optional class room: kids join with the 4-letter code + first name and get a digital board that auto-marks; first 宾果 shows on the big screen.
5. Agent-native: POST /api/boards (returns PDF URL), room API mirrors the browser.
6. Tests for board uniqueness, no duplicate words per board, lines/diagonals win detection, parser reuse. Config for everything (sizes, counts, speeds).
7. Live demo recorded by bingo-night/scripts/record-demo.py; README embeds three ways; add a row to the root README and the CLAUDE.md folder map (append only).
Never describe the game as free in UI or README. Open a PR; Codex reviews before JD.
```

### N2. 墨墨说 Momo Says (我说你做)
**Spec.** A projector-only Total Physical Response game for K-2. Momo says (TTS) and shows a command: 摸摸鼻子, 跳一跳, 拍拍手, 举起左手, 转一圈, and 墨墨说… vs no-prefix trick rounds like Simon Says. The teacher taps "out" or not; there's no scoring device per kid. Command sets are Word Packs with a `command` type (body parts, classroom commands 课堂用语, seasonal: 像蝙蝠一样飞, 像火鸡一样走). Level K: picture + audio; level 2: characters only, a kid volunteer becomes 小老师 and reads the card aloud. It covers the "no devices", "kids perform Chinese" and 课堂用语 (the evergreen poster-set idea in BUNDLES-AND-IDEAS) needs in one small build.

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Branch feat/momo-says. New folder momo-says/ (static Worker is enough; no Durable Object unless you add the optional phone remote).
Build 墨墨说 Momo Says, a projector-only TPR game for K-2:
- Command decks as JSON config (commands/body-parts.json, commands/classroom.json, commands/halloween.json with 像蝙蝠一样飞 etc.). Each command: hanzi, pinyin (tone marks), picture key, trick flag.
- Big-screen loop: Momo animation + TTS (reuse dictation-dash's Workers AI TTS route and cache pattern) + big characters; ~30% of rounds omit "墨墨说" (config). Teacher controls: Next, Repeat, Slower, Show pinyin on/off, Picture on/off.
- Level K (picture + sound), Level 1-2 (characters + sound), Level 小老师 (card only, a kid reads it).
- GET /api/decks and /api/decks/:id for agents.
- vitest for deck validation and the trick-round scheduler (deterministic with a seed).
- Live-recorded demo (screen only; audio muted with ?silent=1 like dictation-dash). Root README + folder map rows appended.
Never call it free. Kid-facing text Chinese-first. PR only.
```

### N3. 你画我猜 Draw & Guess
**Spec.** One kid ("the artist", picked by the room) gets a secret word on their phone and draws it with a finger. The drawing streams live to the projector. Everyone else guesses on their phones by tapping one of 4 word cards (K-2) or writing the characters (3-5, reusing the stroke-checking from Dictation Dash). Fast correct guessers and the artist both score. Words come from the teacher's list or a pack. Seasonal: 猜灯谜 for 元宵节. It reuses Caption Wars' room/turn/vote plumbing, and a teacher-only "hide drawing" button handles inappropriate drawings. No drawings are stored after the round.

```
Repo joydai2026-del/little-games. Read CLAUDE.md, then study caption-wars/ (rooms, turns, voting) and dictation-dash/ (server-side stroke checking). Branch feat/draw-guess. New folder draw-guess/.
Build 你画我猜 Draw & Guess for K-5:
- Teacher makes a room from a pasted list or ?pack=<id>; kids join with code + first name (one word, max 12 chars, same rule as the other games).
- Each turn the room picks an artist (round-robin, config), sends ONLY that phone the secret word, streams normalized stroke points to the big screen (throttled; config).
- Guessers: K-2 = 4 word cards (like stroke-reveal); 3-5 = write the word, checked server-side with dictation-dash's stroke logic. Scoring rewards early correct guesses and gives the artist points per correct guesser.
- Teacher "Hide drawing" + "Skip" buttons. Drawings are kept only in the Durable Object for the life of the round, then dropped.
- Agent-native: an AI player can guess via the same API (reuse caption-wars agent pattern); AI never draws in class mode.
- vitest: turn rotation, secret never leaks to non-artists (assert on every payload), scoring, disconnect/rejoin.
- Live demo with a browser artist + browser guesser + AI guesser. README x3 embeds, root README row. Never "free". PR only.
```

### N4. 部首拼拼乐 Radical Builder
**Spec.** Kids build characters from components: drag 木 + 木 → 林, 氵 + 青 → 清, 口 + 马 → 吗. A round shows a picture or plays a word, and the kid picks the 2-3 components from a tray and drops them into the right slots (left-right, top-bottom, enclosure layouts). Right answers ink in with the real character, and Momo explains the meaning cue (氵 = water). Modes: Build (given the target), Family (make as many 氵 characters as you can from the tray), and Class race. The decomposition data comes from an open dataset (e.g. Make Me a Hanzi decomposition, which the stroke games likely already draw on). The teacher filters to her list, or to the radical sets in Avery's Writing Study volumes. Nothing in MagicSchool/Brisk/Diffit/Twee does this; it's Chinese-specific pedagogy.

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Check which stroke/decomposition dataset trace-race and missing-stroke already use and its license; reuse it (e.g. Make Me a Hanzi dictionary.txt decomposition + etymology) and record the license in the README. Branch feat/radical-builder. New folder radical-builder/.
Build 部首拼拼乐 Radical Builder (grades 1-5):
- Parse the teacher's list; keep only characters with a clean 2-3 component decomposition in ⿰ ⿱ ⿴ ⿺ layouts (report skipped ones plainly). Or pick a radical family (氵 木 口 女 扌 讠 亻 艹 …).
- Kid screen: target shown as picture/sound (K-2 option) or meaning cue; a tray of components incl. distractors (config count); drop zones match the IDS layout. Correct = the real glyph renders in 楷体 and Momo gives a one-line meaning cue in Chinese.
- Modes: Build, Family (timed, as many as you can), Class race (room + code like the others).
- API for agents mirrors the UI.
- vitest: decomposition parsing, layout mapping, distractor generation never includes a correct alternative, scoring.
- Live demo, README x3, root README row. Never call it free. PR only.
```

### N5. 找一找 Write-the-Room QR Hunt
**Spec.** The teacher picks a list; the tool prints 8-16 picture cards, each with a big QR and a number, to tape around the room. Kids (in pairs, 3-5 shared tablets are enough) scan a card, see the picture or hear the word, and write the characters on the device (stroke-checked) or on a printed recording sheet (the sheet is generated too, with 田字格 boxes). The teacher board shows which pairs found which cards. It mirrors the write-the-room printables that sell on TPT, but self-checking, and it gets kids out of their seats.

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Branch feat/room-hunt. New folder room-hunt/.
Build 找一找 Write-the-Room QR Hunt:
- Teacher: paste list or ?pack=<id>, choose 8/12/16 cards, pick 看图写字 (picture) or 听音写字 (audio). Print: cards PDF (big picture, number, QR to /c/<room>/<n>, no English) + a recording sheet PDF with numbered 田字格 boxes (reuse tianzige-generator rendering).
- Kids/pairs: join a room with code + team name; scanning a QR opens that card; write the answer with stroke checking (reuse dictation-dash logic) or tap "I wrote it on paper".
- Teacher board: grid of teams x cards, live.
- QR must decode (test with a QR decoder in vitest or a script). API mirrors the UI for agents.
- Live demo, README x3, root row. Never "free". PR only.
```

### N6. 句子火车 Sentence Train
**Spec.** Word cars must be put in order to make a sentence train leave the station: 我 / 喜欢 / 吃 / 南瓜派. Sentences come from the frames already in Avery packs (我看到了__, 它是__色的, 我感谢__, 天气怎么样). K-2 gets 3-4 cars with pictures; 3-5 gets 5-7 cars, a distractor, and measure-word cars (一只/一个). There are solo and class race modes, and the teacher can type her own sentences (the tool segments them with a dictionary and she fixes any split). It targets the sentence-level gap for grades 2-5 that single-word games don't cover.

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Branch feat/sentence-train. New folder sentence-train/.
Build 句子火车 Sentence Train (K-5):
- Sentence sets as JSON config (frames from Avery packs; seasonal sets per Word Pack). Teacher can paste sentences; segment with a deterministic dictionary segmenter (no LLM in gameplay), show the split for the teacher to fix.
- Kid: drag cars into order; correct = train animates out; wrong = the misplaced car wiggles. K-2 pictures on cars; 3-5 adds distractor + measure words (config).
- Solo + class race (room + code). API mirrors the UI.
- vitest: segmentation fixtures, distractor never forms a valid alternative, order checking with allowed alternates list.
- Live demo, README x3, root row. Never "free". PR only.
```

### N7. 我是小老师 Teach Momo
**Spec.** Momo "forgot" a word and a kid teaches it: the kid sees a picture, says the word aloud, and the class (or the teacher) votes 对/再试一次. There's **no automatic pronunciation scoring**: speech recognition for young Mandarin-speaking children is still a research problem (see FUTURE-STRATEGY §1d), so a wrong machine verdict in front of the class is worse than none. It's a speaking game run by the teacher on the projector, with an optional "listen to Momo" model audio first. Silly Momo reactions when the class votes 再试一次 keep it light. No audio is recorded or stored.

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Branch feat/teach-momo. New folder teach-momo/.
Build 我是小老师 Teach Momo (K-3, projector-first):
- Big screen: picture (from pack) + "Momo forgot this word!"; teacher taps a kid's name (from the room roster or typed first names) as 小老师.
- Optional model audio (reuse dictation-dash TTS cache). NO microphone capture and NO speech scoring in v1; state that in the README.
- Class vote: kids tap 对 / 再试一次 on phones, or the teacher taps it (no-device mode). Momo reacts (config-driven animation set).
- Rounds, streaks, and a "Momo learned N words today" summary. Nothing stored after the room closes.
- vitest for round flow + vote tally; live demo; README x3; root row. Never "free". PR only.
```

### N8. 飞行棋 Class Board Game
**Spec.** A projector board game for 2-4 teams, the digital twin of the board games printed in every Avery seasonal pack (蝙蝠回山洞, 去吃大餐, 去堆雪人, 拜年去). A team rolls the big on-screen die, moves, and must read / say / write the word on the square (the teacher taps right or wrong; optional kid-device write mode). Special squares include 前进2, 后退1 and Momo cards. Boards are skins per season. Low tech risk, high seasonal reuse, and it mirrors pack content so teachers see "the pack comes alive".

```
Repo joydai2026-del/little-games. Read CLAUDE.md. Branch feat/class-board-game. New folder board-game/.
Build 飞行棋 Class Board Game (K-5, projector):
- Board layouts as config (path of N squares, special squares). Seasonal skins via packages/avery-packs skin fields (bat cave, Thanksgiving feast, snowman, 拜年).
- 2-4 teams, big die animation (seeded RNG in tests), each square shows a word from the list with a task: 读一读 / 说一句 / 写一写. Teacher taps 对/不对; optional device write mode reuses dictation-dash stroke checks.
- API mirrors UI for agents. vitest: movement, special squares, win condition, seeded dice.
- Live demo, README x3, root row. Never "free". PR only.
```

### Running these in parallel (merge-conflict guard)
- Each new game touches only its own folder + one appended row in the root README and in the CLAUDE.md folder map. Rebase on `origin/main` right before opening the PR; resolve the two table rows by keeping both.
- Order: S0 (Word Pack core) first, alone. Then S1 skins + N1 + N2 in parallel (all small). Then N3/N4 in parallel. N5-N8 after the Teacher plan launches, based on what founding teachers actually play.
- Paywall wiring stays out of these prompts. Games expose `PRODUCT.paidLater`-style config only; the hub gate lands via the avery-hub plan (PR #18) so the game branches don't collide with it.
