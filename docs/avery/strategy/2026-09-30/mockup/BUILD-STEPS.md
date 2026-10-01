# Avery Studio future platform: build steps (2026-09-30)

Companion to the clickable mockup in this folder (`index.html`, screenshots in `screenshots/`). Sources: `reports/strategy-2026-09-30/FUTURE-STRATEGY.md` (§2a–2e), `GAMES-IDEAS.md` (§2–3), `MARKETING-STATUS.md`.

**One-line product:** a K–5 Chinese immersion teacher browses a QA-checked library, or tells 墨墨 Momo what she needs in plain words. Within one school day she gets a leveled Chinese pack plus the same words loaded into all six Avery games. Teacher Review and Student Review bots check every pack, and a person signs off.

## Phases: now → MVP (about 4 weeks)

| Phase | Dates | Build | Done when |
|---|---|---|---|
| **0 · Align** | Sep 30 – Oct 2 | JD reviews this mockup; confirm the "Pumpkin v3" QA definition; reconcile the three pricing drafts (this mockup uses $29 founding → $39/yr → $199 campus) | JD has picked the screens and the price |
| **1 · Plumbing** | Oct 5 – 9 | Request form (grade, words, theme, activity types, level mix) behind Google sign-in on avery-hub → spec JSON. Word Pack JSON + `?pack=<id>` in one game (Trace Race), then the rest. 田字格 sheet via the tianzige API. Library page v0 reads the existing 9 TPT packs (covers, previews, word lists) | A pasted list opens Trace Race and prints a 田字格 sheet |
| **2 · Templates + QA** | Oct 12 – 16 | Parameterize 4 proven TPT templates in the private factory repo: 看字涂颜色 mystery picture, 掷骰子 roll & build, 看图写字/写句子, 宾果 bingo, plus the 课堂游戏 QR page. Teacher + Student review bots and scripted checks (English scan on student pages, QR decode, stroke coverage, 简繁 mix) run on every render. Approval queue page for JD | A request renders a PDF with the QA verdict attached |
| **3 · Deliver** | Oct 19 – 23 | Private download (PDF stamped with email + date) and a "Play these words" link. My Classroom v0: saved lists, saved packs, projector launcher, season switch. 5 internal test requests across K–1 / 1–3 / 2–5 | Median delivery < 1 school day on the tests |
| **4 · Founding beta** | Oct 26 – 30 (buffer) → Nov | Invite the first 10–20 founding teachers from the waitlist. Bingo Night + Momo Says projector games (GAMES-IDEAS N1/N2). Measure time to deliver, first-try QA pass rate, and teacher rating | ≥ 80% first-try QA pass, rating ≥ 4/5 |
| **Launch** | Nov → Dec 1 | Paywall (Stripe/Gumroad on avery-hub), founding $29/yr for the first 100, then $39/yr; campus $199 one-pager. Privacy policy (joydong PR #88) finished before anyone is charged | 20 paying teachers by Dec 31 |

Not in the MVP: instant generation, per-student adaptation, pronunciation scoring, campus admin, new custom art per request.

## How it grows out of TPT

```
TPT pack (reviewed, Pumpkin v3 standard)
  └─ 课堂游戏 teacher page in every PDF: QR + this pack's word list
       └─ averystudio.org/games?pack=<id>  →  "unlock the games + library"
            └─ founding-teacher list (Kit)  →  $29 founding membership
                 └─ custom requests  →  best requests graduate back to TPT as new reviewed SKUs
```

- **TPT stays the cash path and the template source.** Every mechanic that passed Teacher + Student review becomes a library template. Don't bulk-list generated packs on TPT.
- **Every TPT PDF points to the platform** through the H3 课堂游戏 page, and every game's end screen points back to the paired TPT pack ("Print this week's practice").
- **The library is the TPT catalog, re-shelved** by grade, season, theme, skill and level, with the same covers and previews teachers already trust.

## Marketing channels (in order of effort ÷ return)

1. **TPT itself**: seasonal SKUs on the calendar (Autumn Oct 5, Reader Oct 8, Thanksgiving, Winter, 春节), Message Followers notes, PAIR WITH links, the H3 QR page.
2. **averystudio.org SEO / AEO**: the /guides pages (Halloween, Thanksgiving, stroke order), llms.txt, and a waitlist block on every guide.
3. **Email (Kit)**: founding list, welcome + founding-offer emails, a monthly "this month's pack + game" drop. Blocked until JD creates Kit.
4. **Pinterest**: pin queue batches (covers + guide pins), once the account is connected.
5. **Teacher communities** (outreach drafts D1–D10: immersion Facebook groups, 小红书, CLTA-US / CLASS, Reddit). Each one is sent as JD, after JD approves it.
6. **Short demo videos**: Trace Race, Stroke Reveal, Bingo Night on a projector.
7. **Campus, later**: founding teachers introduce their coordinators; $199 one-pager; conference talks in 2027.

## What JD should react to in the mockup

- Library filters (grade, season, theme, skill, level): is that the right shelf order?
- Trust strip wording ("Reviewed by teacher + student reviewers ✓ · signed off by a person").
- Request form: is plain words + a messy paste box enough, or do teachers need page-by-page picks?
- My Classroom: is the class-wide season switch plus projector "Play now" the right home for Bingo Night and Momo Says?
- Pricing copy (draft, not final).
