# Avery Studio marketing status + next 2 weeks (as of Wed 2026-09-30, 9:45 AM ET)

Sources read: `/workspace/avery-ops/reports/growth-2026-09-29/` (README, CHANNEL-MAP, OUTREACH-TARGETS.csv, OUTREACH-DRAFTS D1-D10, MF-NOTE-2026-09-30-DRAFT, PINTEREST-PINS-TOP6 + pins/, OUTREACH-AGENT-RECOMMENDATION, GAMES-SUBSCRIPTION-LAUNCH-PLAN), `weekday-promo-2026-09-29/`, `DAILY-OPS-2026-09-29.md`, `ops/SEASONAL-CALENDAR.md`, the joydong.org PR list, and the live site.
**Nothing was sent, posted or DM'd while preparing this.**

## ⚠ Files you asked about that don't exist on the box
- **`/workspace/avery-ops/reports/pinterest/` and `PIN-LOG.md`: not found** (searched the whole box by name and by content). There's no log of which pins, if any, were posted.
- **`growth-2026-09-29/EMAIL-LIST-PICK.md`: not found.** The only list-provider notes are in CHANNEL-MAP #6 ("Kit or Buttondown… MailerLite too") and the launch plan. Your note that "Kit signup needs JD" is the only record that Kit was picked.
- Indirect evidence: joydong.org **PR #93 "add Pinterest domain verification"** merged 2026-09-29 11:11 PM ET, and the meta tag `p:domain_verify` is live on averystudio.org. So a Pinterest business account was at least started and the domain claim is in progress. Whether any of the 6 pins are live is **unverified**. If another agent ran the pin session, its log didn't land in this folder.

## Numbers (from 2026-09-29 daily ops)
TPT MTD Sep 1-29: **$46.94 sales / $37.54 earnings**, 6 orders, **6 followers**. Top search terms: moon festival, mid autumn festival, chinese stroke. The Sep $100 goal won't be met (CHANNEL-MAP says so plainly). October's goal is compounding channels.

---

## Done
| Item | Evidence |
|---|---|
| Channel map, ranked by revenue ÷ effort, with verified orgs/URLs and a CAN-SPAM note | `CHANNEL-MAP.md` |
| **3 AEO guides + /guides index live**, founding-teacher waitlist block on /games and every guide, sitemap + llms.txt | joydong.org PR #91 merged; all URLs return 200 today (`/guides`, `/guides/chinese-halloween-activities`, `/guides/chinese-vocabulary-games-k5`, `/guides/mandarin-immersion-teacher-faq`) |
| Google Search Console verification tag on averystudio.org | PR #92 merged (the sitemap still needs submitting inside GSC; see blocked) |
| Pinterest domain verification tag | PR #93 merged |
| Site copy no longer calls the games free | PR #90 merged |
| Bat Craft & Coloring live on TPT and featured on averystudio.org | SEASONAL-CALENDAR "DONE"; PR #94 merged |
| 6 Pinterest pin images (1000×1500) + titles, descriptions, alt text, boards | `PINTEREST-PINS-TOP6.md`, `pins/*.png` |
| TPT Message Followers note for Sep 30 drafted (no emoji, games never called free, no 20YEARS claim) | `MF-NOTE-2026-09-30-DRAFT.md`; a version was also saved in TPT Inbox > Drafts on 9/29 |
| 16 outreach targets with contact/posting rules + 10 tailored drafts (D1-D10) | `OUTREACH-TARGETS.csv`, `OUTREACH-DRAFTS.md` |
| Games subscription launch plan (tiers, funnel, Dec 1 timeline) | `GAMES-SUBSCRIPTION-LAUNCH-PLAN.md` |
| Growth pack pushed to little-games | little-games PR #25 (open) |

## ⚠ Fix before the MF note goes out
The draft **saved inside TPT Inbox** (captured in `weekday-promo-2026-09-29/mf-send.json`) is an older text. It says **"Free classroom games (paste your word list): https://www.averystudio.org/games"** and opens with a Mid-Autumn line. That breaks the never-call-the-games-free rule. The correct text is in `MF-NOTE-2026-09-30-DRAFT.md` (subject "October Chinese: Halloween Mini Bundle for your class"). Whoever sends must paste that version over the TPT draft first. Also consider adding one line for **Bat Craft ($4.99, now live)** next to Pumpkin. The guides URL in the note is live, so the "Planning tip" paragraph can stay.

## Left to do (no JD identity needed)
- TPT SEO pass on the 6 Halloween titles + Mini Bundle (put "Chinese Halloween / Mandarin / immersion / K-5 / 万圣节" in the first 80 characters; add tags), and add Bat to the Mini Bundle or create the $8 Craft Duo (a pricing call; see blocked).
- PAIR WITH Bat on Pumpkin, the Mini Bundle and the FREE Halloween vocab listing.
- FREE "Avery Games word-list starter" TPT printable (QR → /games + waitlist).
- Pin variants (2 per top-3 product), guide pins, autumn pins, all in a dated queue folder.
- 3 vertical 15-30 s demo videos from the existing game gifs (Trace Race, Stroke Reveal, Whack-a-Word).
- Guides #4-5: Thanksgiving for K-5 immersion, and stroke order K-2.
- Autumn Activity Pack + Autumn Reader: finish Teacher/Student review and launch Oct 5-12.
- Weekly MF drafts, a Kit form PR ready to merge, AEO tracking (5 questions).

## Blocked (needs JD)
| Blocker | Why it needs JD | What's ready the moment she unblocks |
|---|---|---|
| **Kit signup** (email list provider) | Account creation = identity (and maybe spend) | A joydong.org PR that swaps the mailto waitlist for a Kit form (double opt-in) on /games + every guide, with a placeholder form ID. Plus a welcome email and a founding-offer email **drafted, not sent** |
| **Outreach D1-D10** | Each is a message as JD. D4/D6/D7/D9 need JD's own accounts (Facebook, 小红书, Instagram/YouTube, Reddit). **D10 must wait** until level-sorted word sets exist | Drafts final in `OUTREACH-DRAFTS.md`. Suggested approval order: D2 (CELIN), D1 (MIPC), D5 (Google Group), D8 (CSAUS/NCACLS), D3 (CLASS) |
| **TPT Message Followers note** | Drafted; this run was told not to send. (CHANNEL-MAP lists MF under the ops runs' standing TPT authority, so JD should say whether the daily-ops run sends it today or she wants to review first.) Cooldown: last sent 9/23, window opens 9/30 | `MF-NOTE-2026-09-30-DRAFT.md`, with the TPT-draft fix above |
| **Pinterest posting** | Posting to Avery's Pinterest is a public post; the account isn't connected to the box, and there's no pin log | 6 pins + copy + boards; next batch in the queue |
| **Search Console / Bing Webmaster sitemap submit** | Logged-in owner action | Sitemap URL: https://www.averystudio.org/sitemap.xml |
| **Pricing decisions** | Money. Bundle $14.99 vs $8 Duo; reconcile the three subscription drafts (launch plan vs joydong PR #88 vs $29 founding → $39 → $199 campus) | Options written in `seasonal-pipeline-2026-09-29/BUNDLES-AND-IDEAS.md` and FUTURE-STRATEGY §2c |
| **Privacy policy page** (joydong PR #88, draft) | Has `[JJ: …]` placeholders (mailing address, governing-law state, phone); needed before charging, directory listings or campus deals | Draft PR exists |

---

## Next 2 weeks of promotion we can do without sending anything as JD (Oct 1-14)
Rule for every row: builds, TPT listing edits, PRs to our own site and drafts are fine. **No emails, DMs, group posts, social posts or Pinterest pins go out as JD** without her explicit OK. MF sends happen only if JD confirms the standing authority. Never call the games free.

| Date | Action | Channel | Output |
|---|---|---|---|
| **Thu Oct 1** | Halloween title/tag SEO pass (6 listings + Mini Bundle); PAIR WITH Bat on Pumpkin, Mini, FREE vocab | TPT (own listings) | Changes verified on the public pages |
| Thu Oct 1 | Replace the stale TPT inbox MF draft with the correct text (save as draft only; don't schedule) | TPT drafts | Corrected draft ready for whoever sends |
| **Fri Oct 2** | Kit form PR on joydong.org behind a placeholder form ID (unmerged until JD creates Kit); welcome + founding-offer emails drafted | Site PR + drafts | PR link + `drafts/kit-emails.md` |
| Fri Oct 2 | Pin queue batch 1: variant 2 for the Mini Bundle, Pumpkin, FREE vocab; 2 guide pins; 1 Bat pin | `reports/pins-queue/2026-10-02/` | 6 images + copy (not posted) |
| **Mon Oct 5** | Monday pipeline research; launch **秋天来了 Autumn Activity Pack** if both reviews pass; FREE 秋天 apple mystery-picture funnel | TPT | New live SKU + freebie |
| Mon Oct 5 | Site season sync: Featured adds Autumn second, after Halloween | Site PR | Merged + checked live |
| **Tue Oct 6** | Guide #4 "Thanksgiving activities for K-5 Chinese immersion" (vocab + pinyin, 1-week plan, K-1/2-3/4-5 tiers, waitlist block) | Site PR | Live guide, sitemap updated |
| Tue Oct 6 | 3 vertical demo videos (Trace Race, Stroke Reveal, Whack-a-Word) from existing gifs, with captions from D6/D7 | `reports/video-queue/` | mp4s ready for JD to post or not |
| **Wed Oct 7** | Draft MF note #2 (Bat + Autumn pack + FREE 秋天 + the Thanksgiving guide); the 7-day window opens Oct 7 if the 9/30 note goes out | TPT draft | Draft only |
| Wed Oct 7 | FREE "Avery Games word-list starter" printable (seasonal lists + QR to /games + waitlist); passes Teacher/Student review | TPT | New FREE listing |
| **Thu Oct 8** | Launch **小松鼠的秋天 Autumn Reader** (after reviews); cross-link it with the Autumn pack | TPT | New live SKU |
| Thu Oct 8 | Add the 课堂游戏 page (Style Standard H3: QR + word list) to any live pack still missing it; re-upload | TPT | Updated PDFs |
| **Fri Oct 9** | Pin queue batch 2: autumn pack/reader + Thanksgiving guide pins; board order updated in the setup doc | Pins queue | 6 images + copy (not posted) |
| Fri Oct 9 | AEO check: are the /guides indexed (site: queries)? Do ChatGPT/Perplexity cite averystudio.org for 5 tracked questions? | Report | `reports/aeo-log.md` |
| **Mon Oct 12** | Monday research; Halloween final push: "last call" urgency lines on the Halloween listings (true claims only; no invented sale); Halloween Craft Duo if JD approved the price | TPT | Listing edits |
| **Tue Oct 13** | Guide #5 "How to teach Chinese stroke order in K-2" (feeds the evergreen "chinese stroke" search term; links FREE strokes → Bridge → Writing Study; Trace Race + Missing Stroke) | Site PR | Live guide |
| **Wed Oct 14** | 2-week review: TPT followers, waitlist count, orders, guide traffic; refresh OUTREACH-TARGETS.csv; send JD a one-screen approval queue (Kit, pins, D1-D5, MF, pricing) | Report to JD | `reports/growth-review-2026-10-14.md` |

**Targets by Oct 14** (halfway to the Oct 31 goals in OUTREACH-AGENT-RECOMMENDATION): TPT followers 6 → 12; ≥ 1 Halloween sale per week; 2 autumn SKUs live; 2 new guides live; waitlist ≥ 15 (depends on Kit, since mailto undercounts); pins ready for posting (≥ 18 in the queue).

## One-screen approval queue for JD (copy/paste)
1. Create the Kit account → send the form ID (unblocks the waitlist PR).
2. MF note: OK the corrected 9/30 text, and say who sends.
3. Pinterest: confirm the account exists, and whether ops may post our own drafted pins (standing permission) or JD posts.
4. Outreach: approve D2 CELIN and D1 MIPC first (both are one-to-one to published resource addresses).
5. GSC + Bing: submit the sitemap.
6. Pricing: Mini Bundle $14.99 with Bat vs an $8 Craft Duo; and confirm the subscription as $29 founding → $39/yr, $199 campus (then PR #88 and PR #18 get updated to match).
