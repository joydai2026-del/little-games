# Avery Studio future platform: clickable mockup (2026-09-30)

Static HTML/CSS/JS, no backend. Open `index.html` in a browser (1440px desktop). Tabs: 资源库 Library · 教学包 Pack detail · 定制 Request a pack · 我的教室 My Classroom · 会员 Membership. Pack cards open their detail page; the request form parses a messy word paste live; "Build my pack" animates the draft → teacher check → student check → sign-off → ready steps; the classroom season switch retints the projector preview.

- Covers, previews and pages are **real Avery TPT art** (pumpkin v3, seasonal pipeline). Word lists, counts, timings, class results and pricing are **sample / draft**.
- Brand: `docs/avery/brand/AVERY-BRAND-GUIDE.md` tokens, Baloo 2 + Quicksand, Momo + brush, L4 lockup.
- Screenshots: `screenshots/00-overview.png` + `01…05-*.png` (full page) and `*-viewport.png` (1440×900).
- Rebuild screenshots: `python shoot.py` (Playwright + Chrome), then `python make_overview.py`.
- Plan: `BUILD-STEPS.md`.

Deep links: `index.html#library`, `#pack/pumpkin`, `#request` (`?step=2#request` shows mid-progress), `#classroom` (`?game=says#classroom` for Momo Says), `#pricing`.
