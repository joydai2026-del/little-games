# Avery Classroom Games — pickup brief for Claude Code / Fable

**Repo:** `joydai2026-del/little-games`  
**Date:** 2026-09-28  
**Brand:** Avery Studio · mascot 墨墨 (Mòmo) · cream / mint / coral  
**Audience:** Chinese K–5 immersion and heritage teachers (US school calendar)  
**Site hub (draft):** [averystudio.org/games](https://averystudio.org/games) — not live until JD says the demo is OK.

## North star

**Student energy. Make it fun.**

Kids should *perform* Chinese: laugh, race, and teach Momo. A round should feel like a game they want to play again, not another drill worksheet. When a choice is between more features and more fun, pick fun. Sell **minutes saved** and **fun centers**, not a feature count.

Respect the house rules in `CLAUDE.md` / `AGENTS.md`: plain English UI, phone-first (tablets for kids and teachers), Cloudflare Worker shape, branch `feat/<game>-<thing>`, never commit straight to `main`.

Related live demos (may live outside this repo today):

- Vocab Game Generator: https://bilingual-vocab-game.joyd-ai-2026.workers.dev
- Caption Wars: https://caption-wars.joyd-ai-2026.workers.dev (already in this repo)

---

## Subscription (locked lean)

| | Free forever | Paid |
|---|---|---|
| Price | $0 | **$39 / year** (preferred over $4/mo) |
| **List** | **1** saved vocab deck | Unlimited decks + named classes |
| **Mode** | **1** play style on that deck | All modes unlocked |
| Extra | — | Share / class codes, seasonal packs, print center cards, Parent Night links |

### What “one list” and “one mode” mean

- **List (vocab deck):** a set of words the teacher owns for a unit or week. Example: 12 Halloween words — 南瓜 / 糖果 / 蝙蝠… with optional pinyin, English, and a picture. Pasting or importing creates or updates a list. Free users may keep **only one** such deck saved (they can replace it).
- **Mode (play style):** how that list is *played*. Examples already in Vocab Generator thinking: Memory Match, Race, Climb, Dash. **听一听 Sound Sprint** is a **mode inside Vocab Generator** (TTS or record, then tap the picture or character). It is **not** a separate product and must not get its own repo or folder. Free users unlock **only one** mode. Paid unlocks all.

---

## Build priority (JD 2026-09-28)

1. **Polish Vocab Generator** (fun + classroom): share / class code, big K–2 targets, timer / mute, print center card, Momo reactions and outfits, Avery rebrand tokens. Add **Sound Sprint as a mode** here.
2. **笔顺 Trace Race** — the next **standalone** game (stroke-order race; ties Avery FREE strokes to Bridge printables). High student energy. This is the next new folder, not Sound Sprint.
3. **Teach Momo / perform modes** — wrong answers make Momo silly; karaoke blanks; comics speech bubbles. Fun first. Kids perform Chinese.
4. **Festival skins** — Halloween and the rest as content packs on existing engines, not new codebases.
5. Soft **$39/yr** gate after free forever works (1 list + 1 mode).
6. Caption Wars stays secondary for classroom until it is clearly labeled, or until a classroom mode exists.

**Tianzige Generator** (田字格练习生成器) is a first-class classroom tool, not a new game. JD approved it on 2026-09-28. Build it after Vocab Generator polish, together with List Lab (they can share stroke data). It does not replace Trace Race as the next standalone game. Spec is under Classroom tools.

### Deprioritize / clarify

- Do **not** build Sound Sprint as its own repo or folder. It is a Vocab Generator mode only.
- “Other websites” below are **tools on the same Avery product**, not separate domains or brands.

---

## Classroom tools (same Avery site — not new brands)

Small utilities that feed games or help a teacher get through the day. Same design system. Later they can be folders in this repo or routes on averystudio.org.

| Tool | What it is in plain English |
|---|---|
| **List Lab** | Paste or upload a word list (or rough TPT vocab text) and get a clean 中文 + pinyin + English deck that every game can load. |
| **Tianzige Generator** (田字格练习生成器) | Paste characters or words and get printable stroke-order 田字格 rows right away. Spec below. |
| **Parent Night Lite** | Teacher sends one link. The kid plays the **same list** at home in 8 minutes and gets a “done” stamp to screenshot. |
| **Randomizer+** | Fair name picker that also flashes today’s target 字. Opens every morning. |
| **Sub Plan Generator** | Emergency slides and a printable from one list when a sub walks in. |
| **Progress postcard** | Cute “words we learned this week” card for folders. |

### Tianzige Generator (田字格练习生成器)

First-class Avery tool. JD approved 2026-09-28. Docs only until a build task says to start. Same Avery site and design system, not a new brand or domain.

A teacher pastes their own characters or words. Messy formatting is fine: spaces, line breaks, punctuation, mixed 中文 and notes. The sheet appears immediately. No account, no setup steps on screen.

**Lists are always the teacher’s paste.** Never Avery’s fixed character bank.

One character per printable row, in paste order. A repeated character stays repeated. The reference sheet for 好好学习天天向上 is eight rows: 好, 好, 学, 习, 天, 天, 向, 上. Each row, left to right:

1. **Bold reference 字** in the first 田字格 (black, full weight).
2. **Stroke-by-stroke buildup** in light gray. Each next cell adds one stroke until the character is complete.
3. **Gray full-character trace cells.** The finished character sits in gray so a child can trace it.
4. **Empty 田字格** for free practice.

Reference UX: [an2.net Tianzige worksheet](https://www.an2.net/tools/worksheet/tianzige), in the 好好学习天天向上 style above (bold model, gray stroke steps, gray trace copies, blank grids).

**When to build:** after Vocab Generator polish, with List Lab. Tianzige can share stroke data with List Lab and with Trace Race. It is not its own product, and it is not a substitute for Trace Race.

**Later, not the first slice:** a red-and-black practice variant, and print to PDF.

---

## Suggested new folders in this repo

When a build starts, create a `feat/...` branch and a folder like:

- `vocab-generator/` — if or when the bilingual vocab game moves here, or is mirrored here, for Avery classroom work. Sound Sprint lives inside this product as a mode.
- `trace-race/` — 笔顺 Trace Race, the next standalone game.
- `docs/avery/` — this pickup brief and later plans.

Keep Caption Wars rules. Avery classroom products should still pass the grandma / phone test where it fits teachers and kids on tablets.

---

## Out of scope unless asked

- Cold email to random teachers
- Publishing averystudio.org/games without JD’s demo OK
- Replacing the TPT printables cash path (games ride the same teachers)
- Implementing any game or tool from this brief until a build task says to start (including Tianzige Generator)
