# Avery Studio: where teacher-resource marketplaces are heading with AI, and what Avery should do (2026-09-30)

Owner: JD. Research as of 2026-09-30; every external claim has a numbered source at the bottom. Internal numbers come from the Avery ops reports in `/workspace/avery-ops/reports/`.

**Thesis, in one paragraph.** Generic AI tools (MagicSchool, Brisk, Diffit, Twee) have already made "generate a worksheet on any topic" a commodity, and TPT is fighting a flood of low-quality AI listings. What teachers still lack, and still pay for, is **trusted, level-right content in their exact niche that a person has vouched for**. Avery can own one narrow version of that: *a K-5 Chinese immersion teacher says or types what she needs (topic, grade, words), and within a day she gets a leveled Chinese pack plus the same words loaded into Avery's games, checked by our Teacher Review and Student Review bots against the Pumpkin v3 standard and signed off by a human.* It's sold as a small yearly subscription on averystudio.org, fed by the TPT catalog, and it stays honest about scale: this is a niche business worth thousands, maybe tens of thousands, a year, not a venture-scale one.

---

## 1. Research: the market in 2026

### 1a. TPT and AI
- **No TPT-branded generative tool for buyers or sellers could be confirmed as of today.** TPT's 2025-26 product launches on the seller side are analytics (the Product Insights Report, Nov 2025) and tag/filter changes aimed at Google search [1][2]. A seller podcast recap of TPT Forward 2026 says TPT is planning AI-search landing pages, but that's secondhand and I couldn't verify it from TPT itself [3]. Treat it as a rumor.
- **TPT's AI stance is defensive: quality and disclosure.** In its 20-year announcement, TPT says 83% of educators it surveyed have used AI, but most are comfortable with AI-made materials only when a person has reviewed or refined them. It has "implemented tools to surface and remove stores associated with low-effort, AI-generated content, with additional policies and guidelines to come" [4].
- **The "AI slop" problem is now public.** Chalkbeat (Aug 3 2026) documented error-filled AI resources on TPT (an alphabet sheet missing F, mislabeled history posters). IXL's CEO answered that algorithmic tools "identify and demote stores associated with low-quality, AI-generated content" and that such products are "a minuscule fraction of a percent of TPT's sales" [5]. Seller-side guides report that substantially AI-generated listings are expected to be disclosed and that undisclosed ones get de-ranked [6]; that's a third-party read, not TPT policy text.
- **What it means for Avery:** TPT will keep rewarding human-reviewed, visibly original work, and it will push harder against bulk AI listings. Avery's Teacher/Student QA gates and the Pumpkin v3 redesign are the right posture. **Don't flood TPT with generated SKUs.** Put the generator on averystudio.org and keep TPT for curated, reviewed products.
- TPT's parent IXL also owns Rosetta Stone and Education.com (visible in TPT's own footer). If IXL ever adds generation, it'll be broad and English-first. A K-5 Chinese immersion niche is unlikely to get first-class attention.

### 1b. Teacher AI adoption
- **60% of US public K-12 teachers used an AI tool for work in 2024-25; 32% weekly.** Weekly users estimate saving **5.9 hours/week, about six weeks a year**. The top uses were preparing to teach (37% at least monthly), **making worksheets or activities (33%)**, and **modifying materials for student needs (28%)** [7][8]. That's exactly Avery's job-to-be-done: make or level materials.
- **Guidance lags:** in Feb-Mar 2026 only 18% of teachers had received formal guidance from administrators on AI use, and 47% had no guidance at all on using AI to create assignments and class materials [9][10]. Teachers are adopting individually, bottom-up. That favors a low-price, teacher-paid product over a district sale in year one.
- Teachers who work at schools with an AI policy save 26% more time, but only ~19% of teachers are at such schools [8]. Campus pricing becomes easier once schools write policies. That's a 12-month-plus play.

### 1c. The AI teacher-tool competitors

| Tool | What it is | Scale / money | Individual price | Chinese K-5 fit |
|---|---|---|---|---|
| **MagicSchool** | 80+ generators: lesson plans, leveling, rubrics; student-facing tools; district-governed | ~8M educator sign-ups, 10,000+ partner schools, ~$63M raised (Series B $45M, Feb 2025) [11][12] | Plus $12.99/mo or ~$99.96/yr [13] | Generic multilingual text. No stroke order, 田字格, character-level scaffolds or games |
| **Brisk** | Chrome extension: level any page, feedback, quizzes, "Boost" student activities | 1M+ educators, 2,000+ schools; "1 in 5 US K-12 teachers" installed by Feb 2025; $15M Series A (Mar 2025) [14][15] | Individual plan free; Premium/Intelligence are school/district only, per-student pricing (plans page now claims 10,000+ districts) [13b] | Generates in "50+ languages" [13b], but has no Chinese literacy tooling (stroke order, 田字格, character games) |
| **Diffit** | "Leveled resources for any topic": readings, vocab, questions, graphic organizers | VC-backed (undisclosed) [16] | $14.99/mo or $149.99/yr; school licenses by quote, POs for schools only [17] | Can output other languages, but it's reading-passage centric, not character practice |
| **Twee** | AI lesson builder for language teachers (ESL/EFL focus, CEFR levels), audio, worksheets | Smaller | Trial 5 runs; Basic ~$6.50/mo and Pro ~$10.50/mo billed yearly [18][19] | Closest in spirit (language teachers). CEFR and adult/teen ESL focus; not K-5 Chinese immersion |

**Read-across.** (1) Generic generation is heading to free: Brisk gives its individual plan away and MagicSchool's value is district governance. (2) Where teachers do pay individually, the price is **$100-150/yr** (MagicSchool Plus, Diffit), so Avery's **$29-39/yr is well under the market** and easy to expense or pay personally. (3) No one does **Chinese character pedagogy** (stroke order data, 田字格, radicals, Chinese-only student pages, simplified/traditional) or **K-5 immersion games from the same list**. That's the moat, and it's narrow, so Avery has to stay excellent in the niche rather than broad.

### 1d. AI in language learning for young kids
- **Tech-assisted vocabulary works for little kids, moderately.** A meta-analysis of 24 studies (1,759 preschoolers, 2013-2023) found a moderate effect of technology-assisted vocabulary instruction (g ≈ 0.73) [20]. Games from a teacher's list are an evidence-aligned format.
- **Conversational agents can match an adult on some tasks.** A randomized study of 90 children aged 3-6 found story reading guided by a conversational agent supported comprehension about as well as reading with an adult, though the kids talked differently with the agent [21]. That's promising for a later "read with Momo" feature, but it's one study.
- **Child speech recognition is still hard, especially Mandarin.** New corpora like ChildMandarin (ages 3-5, ACL 2025) and ChildTalk (2026) exist precisely because adult-trained recognizers do badly on children's speech [22][23]. **Implication: don't auto-grade K-2 pronunciation in front of a class.** Use teacher-judged speaking (Teach Momo) and model audio (TTS) for now.
- **Consumer players:** Duolingo ABC targets early literacy for ages 3-6 (English) [24]; LingoAce sells live Mandarin classes for ages 3-15 with an AI "co-pilot", AI diagnostics and adaptive exercises [25][26]. They're home and parent products. None plugs into a US immersion teacher's own weekly word list, which is Avery's lane.
- **Privacy is a real constraint.** The FTC's amended COPPA Rule took effect June 23, 2025, with general compliance by April 22, 2026. The FTC did not finalize the proposed edtech/school-authorization changes, so the existing school-consent guidance still applies [27]. Avery's design choice of **no student accounts, first name + class code, nothing kept after the room closes** is the cheapest way to stay safe. Keep it.

---

## 2. Strategy for Avery

### 2a. The product: "Tell Momo what you need" (Avery Custom Packs)
**Teacher flow.**
1. **Ask.** On averystudio.org (signed in with Google via avery-hub), the teacher types or speaks a request: *"Grade 1, 10 words about the farm: 牛 羊 猪 鸡… with a reader and a game for Friday."* Browser speech-to-text is fine for the teacher's voice (adult speech). A short form confirms topic, grade band (K-1 / 1-3 / 2-5), words, simplified/traditional and pages wanted.
2. **Generate.** The model **fills templates, it never invents layouts**, the same principle as the Vocab Games README ("the language model never writes game code"). Deterministic pieces: pinyin (tone marks), stroke data, 田字格 rendering (tianzige-generator API), Word Pack JSON. Model-assisted pieces: the gloss, sentence frames, a short reader, bingo/board-game word placement, and picking art from the Avery illustration banks (new art only when needed and reviewed).
3. **QA.** Our **Teacher Review** and **Student Review** bots check the rendered pages against the **Pumpkin v3 standard**. As I read it, that's the hard rules in `avery-factory/docs/STYLE-STANDARD.md` (H1 Chinese-only student pages, H2 pinyin only on key vocab with tone marks, H3 课堂游戏 page with QR), plus the hard fails in `AVERY-TEACHER-PRINTABLE-QA.md` (no empty bottoms, unique art per word, 楷体, correct stroke pedagogy, real game mechanics) and the kid-lens verdict in `AVERY-STUDENT-KID-QA.md`. Automated checks run too: `pdftotext` English scan, QR decode, stroke-data coverage, simplified/traditional mixing. **JD: please confirm that this is the canonical "Pumpkin v3" definition, or point me to the file.**
4. **Human sign-off (MVP and probably forever for new templates).** JD or ops approves in a queue. The promise is "ready within 1 school day", not instant. This is the trust differentiator against AI slop [4][5]: "checked by a K-5 Chinese teacher's standards and a real person."
5. **Deliver.** A private download on averystudio.org (PDF stamped with the teacher's email and date, as in the pay plan PR #18), plus a **"Play these words" button** that opens all six games with the pack preloaded (`?pack=<id>`, see GAMES-IDEAS §2a).
6. **Adapt to the student level.** v1: the teacher picks the band and every game has Easy/Hard and K-2/3-5 settings (Dictation Dash, Stroke Reveal and Vocab Games already do). v2: games report **room-level** results only (which words the class missed, no per-child records) and the next pack or round reweights toward those words. v3: a "differentiate this pack" button produces the K-1 / 1-3 / 2-5 tiers of the same pack, the tiering Avery's seasonal packs already use. No student profiles; that keeps the COPPA posture intact [27].

### 2b. How today's TPT portfolio feeds this
| Asset | How it feeds the product |
|---|---|
| **Content library** (seasonal packs: Mid-Autumn, Halloween ×5 incl. Pumpkin + Bat, Autumn ×2, Thanksgiving, Winter ×2, 春节 plan; Writing Study Vols 1-5; FREE strokes/radicals) | These are the **templates and art banks**. Every mechanic that passed Teacher + Student review (mystery color-by-character, roll & build, bingo, board game, look & write, word wheel) becomes a parameterized template. The generator is only as good as this library, and that's the moat. |
| **Brand** (墨墨 Momo, L4 lockup, cream/mint/coral tokens) | The same Momo guides the printables, the games and the request box, so it reads as one product and not "another AI tool". |
| **Email list** (founding-teacher waitlist; mailto today, Kit pending JD's signup) | The launch list for the $29 founding offer and the beta cohort. Blocked until Kit exists (see MARKETING-STATUS). |
| **Reviews** (TPT ratings; still few) | Social proof on the landing page; each review is a signal of what to templatize next. Ask for reviews via the TPT follow-up flow only. |
| **SEO / AEO** (TPT search terms: moon festival, mid autumn, chinese stroke, chinese radicals; the /guides pages; llms.txt) | TPT search brings teachers to the PDFs → the 课堂游戏 page QR → /games → waitlist. The guides rank for "Chinese Halloween activities" style queries and end in the waitlist. |
| **Weekly Message Followers + Featured/banner calendar** | A standing monthly drop ("this month's pack + game") gives both TPT and the subscription a reason to come back. |

### 2c. Pricing
- **Teacher plan:** **$29/yr founding** (first 100 waitlist members, locked while subscribed), then **$39/yr**. It includes all games, unlimited saved lists, all Word Packs, projector mode, and **N custom packs per month** (start at 2/month; capping protects review time and model cost).
- **Campus:** **$199/yr, up to 10 teachers** (+$15 per extra, as in the launch plan), invoice/PO, a shared school word bank, room-level usage view, and priority requests.
- **Why this is right:** individual AI tools that charge are at $100-150/yr [13][17], so $39 is an impulse buy for a niche that's otherwise unserved. Campus at $199 fits under most school purchase thresholds (verify locally).
- **Honest math.** MIPC's national list counts **396 US Mandarin immersion programs** (Jan 2026; the list is non-commercial, so use it for sizing only, not marketing). If Avery reached 5-10% of them as campuses, that's **~20-40 campuses ≈ $4-8k/yr**. Add 100-300 individual teachers (immersion + weekend Chinese schools + heritage) at ~$33 average for **$3-10k/yr**. A realistic 12-month outcome is **$5-15k ARR** on top of TPT. It's worth doing because the marginal cost is low and the same library serves both channels. It won't replace a salary in year one.
- **Resolve before launch:** three drafts disagree. The launch plan has a $0 Starter (1 list + 1 mode) with $39/yr and $29 founding. Draft legal PR #88 on joydong.org says there's no free plan (one round per game, then $29/yr or $4.99/mo, "$39 removed"). JD's brief is $29 founding, then $39/yr, and $199 campus. **This doc follows JD's brief.** The policies page (#88), the pay-plan PR #18 and the /games copy need one pass to match before anything is charged.

### 2d. MVP (ship in about 2-4 weeks)
**"Founding Teacher Custom Pack" v0: human-in-the-loop, narrow, real.**
Scope:
1. **Request form** on averystudio.org behind Google sign-in (avery-hub): topic, grade band, 6-12 words (paste or speak), simplified/traditional, one of 3 pack shapes (Mini: 4 pages; Standard: 8 pages; Game-only).
2. **Generator v0** in the private factory repo (not the public little-games repo): 4 templates only, all proven in the Pumpkin/Bat v3 packs: 看字涂颜色 mystery picture, 掷骰子 roll & build, 看图写字/看图写句子, 宾果 bingo. Plus the 田字格 sheet from the tianzige API and the 课堂游戏 page (H3). Art comes from the existing banks first.
3. **QA bots** run automatically on the rendered PNGs (Teacher + Student skills, plus the scripted checks), and the result is attached to the request.
4. **Approval queue:** JD/ops approves, fixes or rejects. The SLA is 1 school day.
5. **Delivery:** private download + a "Play these words" link that opens every game with the list (a simple share link today; `?pack=` once Word Pack S0 lands).
6. **Access:** the first 10-20 founding teachers from the waitlist in a 30-day beta at no charge, then the founding $29/yr on Dec 1 (matches the launch plan).

Week plan:
| Week | Deliverable |
|---|---|
| 1 (Oct 5-9) | Request form + spec JSON + Word Pack export → games link + 田字格 sheet (all deterministic, mostly exists) |
| 2 (Oct 12-16) | 4 templates parameterized in the factory; automated QA run + scripted checks; approval queue (a simple admin page on the hub) |
| 3 (Oct 19-23) | Private delivery on the hub; 5 internal test requests across K-1/1-3/2-5; fix whatever the bots and JD catch |
| 4 (Oct 26-30, buffer) | Invite the first 10 founding teachers; measure time-to-deliver, bot pass rate on the first try, and teacher rating |

What's **not** in the MVP: instant generation, student-level auto-adaptation, pronunciation scoring, campus admin, new custom art per request, traditional-character art variants.

### 2e. Roadmap

| Horizon | Goal | Build | Go-to-market | Success metric |
|---|---|---|---|---|
| **3 months (to Dec 31)** | Prove teachers want custom packs and will pay a little | MVP above; Word Pack system + Halloween/Autumn/Thanksgiving/Winter packs in all games; projector mode; Bingo Night + Momo Says (GAMES-IDEAS N1/N2); avery-hub paywall + Stripe/Gumroad | Kit list live; founding beta Nov 1-30; **Dec 1 launch** at $29 founding; monthly MF + pins + guides; TPT keeps shipping reviewed seasonal SKUs on the calendar | 50+ waitlist; 20 paying teachers; ≥80% first-try QA pass; median delivery < 24h; teacher rating ≥ 4/5 |
| **6 months (to Mar 31)** | Make it a habit and land the first campus | "Differentiate this pack" (3 tiers); room-level results → next-round reweighting; 春节 + 元宵 packs; Draw & Guess + Radical Builder; campus plan (shared word bank, invoice/PO, room-level usage) | Campus one-pager; founding teachers intro their coordinators; CLASS / CLTA-US 2027 talk proposals; D1-D3/D8 outreach if JD approves | 75-100 teachers; first 2-3 campuses; monthly churn < 5%; ≥ 2 custom packs used per teacher per month |
| **12 months (to Sep 30, 2027)** | Semi-automated, trusted niche platform | Auto-approve lanes for templates with a proven QA record (human spot checks only); level-sorted word sets for common DLI themes; traditional-character track; "read with Momo" pilot (TTS reading, no speech scoring); best teacher-requested packs graduate to TPT SKUs after full review | Back-to-school push Aug 2027; ISTE EdTech Index / privacy listing once the policy is final; ambassador program | 200-300 teachers + 10-20 campuses ≈ $10-15k ARR; TPT earnings growing month on month; ≥ 1 AI-answer citation of averystudio.org for tracked questions |

### 2f. Risks (and what we do about them)
1. **Wrong Chinese in front of kids** (unnatural sentences, wrong stroke order, mixed 简繁). *Mitigation:* the model never writes stroke data or layouts; deterministic pinyin/stroke sources; two QA bots plus a human sign-off; teacher "report a problem" on every page; a template graduates to auto-approve only after a clean record.
2. **Human review doesn't scale.** JD's time is the bottleneck. *Mitigation:* cap custom packs per month; narrow templates; price campus requests as "priority" rather than unlimited; measure first-try pass rate and only open auto lanes when it's > 90%.
3. **AI-slop backlash and TPT policy.** *Mitigation:* never bulk-list generated packs on TPT; disclose AI assistance where TPT expects it [6]; lead with "teacher-reviewed" and the visible QA standard [4][5]. Keep TPT listings within TPT's guidelines on promoting outside sites (they already carry a /games line; re-check the current guidelines before adding more).
4. **Children's privacy.** *Mitigation:* no student accounts, no audio storage, room data gone after 2 hours, room-level analytics only. Finish the policies page (PR #88 has `[JJ: …]` placeholders) before charging or listing in directories [27].
5. **A big player adds Chinese.** MagicSchool/Brisk/Diffit could add a Chinese worksheet mode. *Mitigation:* depth they won't bother with (stroke data, 田字格, radicals, Chinese-only standard, six games from one list, a seasonal cadence tied to US immersion calendars, Momo). Stay niche and fast.
6. **Small market, slow growth.** September TPT earnings were $37.54 with 6 followers. *Mitigation:* be honest about scale (§2c), keep TPT as the cash path, don't overbuild. Every build step should also improve TPT products or the games.
7. **Cost creep.** Model and TTS calls per pack, and image generation if we allow new art. *Mitigation:* art-bank-first, cached TTS (Dictation Dash already caches), a monthly cap, and logging cost per pack from day one.
8. **Pricing/plan confusion** across three drafts (§2c). *Mitigation:* one reconciliation pass before Dec 1.
9. **IP leakage.** `little-games` is public. *Mitigation:* the generator, prompts and templates live in the private factory/hub repos; only the game engines stay public.
10. **Platform dependency** (TPT algorithm, Google sign-in, Cloudflare). *Mitigation:* own the email list (Kit) and the domain; keep the games portable.

---

## Sources
1. TPT Seller Blog, "Introducing the Product Insights Report," Nov 10 2025. https://sellerblog.teacherspayteachers.com/introducing-product-insights-report/
2. TPT Seller Blog, "Improvements to the Tags and Filters on TPT." https://sellerblog.teacherspayteachers.com/improvements-to-tags-and-filters-on-tpt/
3. Two Wacky Teacherpreneurs podcast, "TPT Forward 2026 Recap" (secondhand; unverified). https://twowackyteacherpreneurs.buzzsprout.com/2544118/episodes/19507963-tpt-forward-2026-recap-the-biggest-takeaways-every-seller-needs-to-hear-even-if-you-didn-t-go
4. PR Newswire, "TPT Celebrates 20 Years of Being by Educators' Side…" https://www.prnewswire.com/news-releases/tpt-celebrates-20-years-of-being-by-educators-side-helping-millions-thrive-through-tremendous-change-302893712.html
5. Chalkbeat, "An alphabet without an F: AI slop seeps into Teachers Pay Teachers," Aug 3 2026. https://www.chalkbeat.org/2026/08/03/ai-slop-on-teachers-curriculum-marketplace/
6. JustNiches, "What Changed in the TPT Algorithm in 2026" (third-party seller guide). https://justniches.com/blog/tpt-algorithm-changes-2026
7. Gallup, "Three in 10 Teachers Use AI Weekly, Saving Six Weeks a Year." https://news.gallup.com/poll/691967/three-teachers-weekly-saving-six-weeks-year.aspx
8. Walton Family Foundation, "Six Weeks a Year: How AI Gives Teachers Time Back." https://nextgeninsights.waltonfamilyfoundation.org/resources/how-ai-gives-teachers-time-back/
9. Gallup, "Most Teachers Receive No Formal Guidance on AI Use" (survey Feb 9-Mar 2 2026). https://news.gallup.com/poll/710534/teachers-receive-no-formal-guidance.aspx
10. Walton Family Foundation newsroom, May 27 2026. https://www.waltonfamilyfoundation.org/about-us/newsroom/unclear-and-unrealistic-expectations-threaten-teacher-retention-and-wellbeing
11. Crunchbase News, MagicSchool founder profile, Aug 5 2026. https://news.crunchbase.com/venture/educator-built-edtech-startup-ai-magicschool-kahn/
12. MagicSchool, "$45M Series B," Feb 11 2025. https://www.magicschool.ai/blog-posts/series-b-fundraise-for-teacher-ai
13. MagicSchool pricing. https://www.magicschool.ai/pricing · 13b. Brisk plans. https://www.briskteaching.com/plans
14. PR Newswire, "Brisk Teaching Raises $15 Million…," Mar 26 2025. https://www.prnewswire.com/news-releases/brisk-teaching-raises-15-million-to-reinvent-classroom-technology-for-the-ai-era-302412034.html
15. TechCrunch, "Brisk raises $15M…," Mar 26 2025. https://techcrunch.com/2025/03/26/ais-coming-to-the-classroom-brisk-raises-15m-after-a-quick-start-in-school/
16. PitchBook, Diffit profile. https://pitchbook.com/profiles/company/553120-48
17. Diffit, Individual Teacher Subscription. https://web.diffit.me/individual-teacher-subscription
18. Twee. https://twee.com/ · 19. Twee pricing. https://twee.com/price (tier prices per ToolChase review: https://toolchase.com/tool/twee/)
20. "Technology-assisted vocabulary learning for preschool children: a meta-analysis" (24 studies, 1,759 children). https://exa.ai/library/publication/372nyt1ns23
21. "Same benefits, different communication patterns: Comparing children's reading with a conversational agent vs. a human partner." https://matilda.science/work/7c0bce42-9dc3-4350-b07e-f153667e1a36
22. ChildMandarin: A Mandarin Speech Dataset for Young Children Aged 3-5, ACL 2025. https://aclanthology.org/2025.acl-long.614.pdf
23. ChildTalk: A Multi-Dialect Chinese Child Speech Corpus, Findings of ACL 2026. https://aclanthology.org/2026.findings-acl.251/
24. Duolingo ABC. https://www.duolingo.com/abc
25. PR Newswire, LingoAce Chinese program upgrade. https://www.prnewswire.com/news-releases/lingoace-launches-full-upgrade-to-its-chinese-program-leading-in-a-new-era-of-precision-learning-302461382.html
26. PR Newswire, LingoAce ACE Academy. https://www.prnewswire.com/news-releases/lingoace-launches-ace-academy-expanding-from-chinese-to-k-12-math-and-english-language-arts-with-ai-enhanced-learning-302678582.html
27. Federal Register, Children's Online Privacy Protection Rule (final amendments, Apr 22 2025). https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule
- Internal: `reports/growth-2026-09-29/CHANNEL-MAP.md` (MIPC 396-program count, TPT MTD, verified channels), `GAMES-SUBSCRIPTION-LAUNCH-PLAN.md`, `ops/SEASONAL-CALENDAR.md`, `pumpkin-redesign-2026-09-29/STYLE-STANDARD.md`, little-games `docs/avery/ops/AVERY-*-QA.md`, little-games PR #18, joydong.org PR #88.
