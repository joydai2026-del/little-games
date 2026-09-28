# Momo rebrand report, 2026-09-28

**What this is:** the ink-drop Momo and the old cream/mint/coral palette are gone from the kit,
田字格 Writing Sheets and Trace Race. Everything now follows `docs/avery/brand/AVERY-BRAND-GUIDE.md`
(locked 2026-09-24): Momo is the mint puppy with a brush, the colours are the guide's 16 tokens,
headings are Baloo 2 and UI is Quicksand. Evidence grades: A = checked live or by a script run in
this session, B = checked locally, C = assumed.

## Key takeaways

1. **Both games are live with the official puppy** (A). Tianzige version `34343fb9-3a0f-4afa-8c61-39e5870c53b6`,
   Trace Race version `0fc143ef-ff8b-4f6d-9439-63a3354b34bb`, deployed 2026-09-28 19:14 UTC.
2. **All gates green** (A): Tianzige 79 tests, Trace Race 62 vitest + 3 node tests; typecheck, check:xss,
   check:palette and check:brand pass for both. Tianzige live receipt: all 10 built assets MATCH live.
   Trace Race live gate: `allPass: true`, 20 checks.
3. **The brand check now guards the switch** (A): `scripts/check-brand.sh` fails on any `momo.svg`
   (file or reference), any retired colour, or a Momo PNG whose sha256 differs from the kit.

**Needs JJ (WHAT decisions):**

- ~~Two different puppy drawings~~ Decided 2026-09-28: one drawing. All four PNGs now come from
  `momo-brush-official.png`; the tight TPT icon stays for the store only.
- The mp4 user-attachments URLs are reset to `pending, JJ adds` in the root README and both game READMEs,
  because the recordings changed.

## Recommended actions

1. Review and merge the PR.
2. Drop the two new mp4s into a GitHub comment box and paste the URLs into the READMEs.

## What changed

| Area | Change |
|---|---|
| Kit `avery-brand/` | `theme.css` rewritten to the guide's tokens, old names kept as aliases (`--cream`, `--mint`, `--mint-deep`, `--coral`, `--muted`, `--line`); Baloo 2 + Quicksand + Noto Sans SC stacks with local CJK fallbacks; `.avery-header` = L4 lockup in HTML (44 px icon, Baloo 2 wordmark, coral underline, "with 墨墨 Momo"); pink CTAs. `momo.svg` deleted. New `momo.png` (256), `momo@2x.png` (512), `momo-icon.png` (64), `momo-icon@2x.png` (128), all cut from the locked PNGs by `scripts/make-momo-assets.py` (reproduces them byte for byte). README rewritten to the guide. |
| `scripts/check-brand.sh` | Hashes all four PNGs, bans `momo.svg` and the 7 retired hex values, requires the paper theme-color, PNG favicon, Baloo 2 + Quicksand fonts link, header lockup with the @2x srcset. |
| Tianzige | Kit files copied; header lockup; speech-line Momo is `momo.png` with srcset and its CSS bob; game CSS no longer redefines kit tokens (`--paper`, `--ink-soft`); printed sheet keeps white paper, footer wordmark now Baloo 2, grid border on Momo's outline mint (`--mascot-2`, the retired `#3FA88A` could not stay). |
| Trace Race | Kit files copied; header lockup; every in-game Momo (lobby, finish, winners board, 好棒! cheer) is `momo.png` with srcset and CSS bounce / tilt / pop; Momo added to the teacher's Winners board; pink and mint never used as small text (errors are cocoa on a pink-soft chip, countdown is pink-deep); an empty error chip no longer shows. |
| Palette checks | Both `check-palette.mjs` require all 16 locked tokens and reject the retired ones. |
| Demos | Both re-recorded on the live sites (silent): Tianzige gif 7.4 MB, Trace Race gif 2.0 MB; stills refreshed. 3 frames of each looked at. |

## Contrast pairs used (computed, WCAG 2.x)

| Pair | Ratio | Use |
|---|---|---|
| ink on pink | 5.58:1 | `.btn-primary`, any size |
| card on pink-deep | 3.94:1 | button hover, large text only (19 px bold) |
| white on pink | 2.40:1 | fails, never used |
| ink-soft on paper | 6.79:1 | secondary text |
| ink on pink-soft | 10.50:1 | error chips |
| pink-deep on paper | 3.76:1 | large numbers only |

Note: white on pink-deep is 4.04:1, so it passes only as large text, not at body size.

## Screenshots (looked at)

- `tianzige-generator/docs/demo/tianzige-phone.png`, `tianzige-phone-preview.png`, `tianzige-print-letter.png`, `tianzige-print-a4.png`
- `trace-race/docs/demo/trace-race-lobby.png`, `trace-race-kid-tracing.png`, `trace-race-kid-cheer.png`, `trace-race-board-live.png`, `trace-race-winners.png`

## Not done

- **Spikes (PR #8): skipped** on the coordinator's instruction (JJ found them confusing). Before that
  instruction arrived, `feat/avery-brand-momo` had been merged into `feat/momo-fun-spikes` in
  `/Users/joyd/lg-spikes` (merge commit `c3cb476`). No spike file was edited. That merge commit is now on
  `origin/feat/momo-fun-spikes`. This session did not push it; it was pushed from somewhere else. It was
  left as it is (house rules forbid reset).
- The header lockup renders Baloo 2 and Quicksand from Google Fonts. The `/api/sheet` agent page
  cannot load web fonts (its CSP blocks them), so its footer wordmark uses the fallback font (B).
- No test on a real retina iPad. The @2x files load through srcset, but the only check was a headless browser (B).

## Master plan, north star, drift

- **Plan position:** guide section 11 "Rebrand sequence" step 2 (re-skin game UI to Avery) is done for
  Tianzige and Trace Race. Caption Wars and the vocab game are not in this PR.
- **North star:** every Avery game uses the same puppy, tokens and lockup, and a check stops it drifting.
  What is left: one face-only puppy drawing (JJ's pick above), and the same pass for Caption Wars and the vocab game.
- **Drift check:** a real customer need (JJ called the old look ugly). No scope was cut except the spikes,
  and JJ decided that herself.
