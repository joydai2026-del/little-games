# Public readiness check, 2026-09-08

Branch: `feat/caption-wars-public-demo`. No commits made, no branch switches, no git config
touched, per the dispatch instructions. Everything below is a working-tree change only, ready for
the owning session to review and commit.

## What changed

1. **LICENSE** (new, repo root): MIT, year 2026, copyright holder `joydai2026-del` (the GitHub
   account). Grade C: no legal name was given in the dispatch, so the license uses the account
   name. Flag this to JJ if a real name/entity should be the holder instead.
2. **README.md** (repo root): rewritten for a public audience. Covers what Little Games is, the
   Caption Wars entry with the live link (`https://caption-wars.joyd-ai-2026.workers.dev`), a
   3-step "Play it" section, a "Let an AI agent join" section with the exact command
   (`node caption-wars/agent/play.mjs --url <room-server-url> --room CODE --name Claude --brain claude`),
   verified against `caption-wars/agent/play.mjs` (flags are `--url`, `--room`, `--name`, `--brain`,
   `--style`; `--brain` accepts `claude` / `codex` / `grok` / `echo`), a "Demo" section with the
   literal placeholder line `<!-- DEMO -->` on its own line, a stack line, and a link to
   `caption-wars/README.md`.
3. **Scrubbed machine-local references** (`git grep -n -iE '/Users/|jj-knowledge|yd2338|columbia'`
   run before and after):
   - `CLAUDE.md` (and `AGENTS.md`, which is a symlink to `CLAUDE.md`, so it updated automatically):
     a local path to the author's earlier game -> "the author's Bilingual Vocab Game";
     the private vault path -> "a private vault symlink, not in
     this repo". No other line touched.
   - `caption-wars/README.md` line 11: same Bilingual Vocab Game path swapped for the plain
     description.
   - `caption-wars/docs/2026-09-08-openai-provider-build-report.md`: 4 occurrences of
     the local checkout path (verification-run notes) replaced with the
     relative `` caption-wars ``. Doc content otherwise untouched, nothing deleted.
   - `caption-wars/docs/2026-09-08-build-report.html` and `caption-wars/docs/plans/2026-09-07-mvp-plan.md`
     were checked and had no matches, so nothing to change there.

## Grep result (final)

```
git grep -n -iE '/Users/|jj-knowledge|yd2338|columbia' -- . ':!package-lock.json' ':!caption-wars/package-lock.json'
```

No matches (exit code 1). `package-lock.json` and `caption-wars/package-lock.json` were exempted
per instructions and not scanned.

## .gitignore / file listing

- Root `.gitignore` already lists `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars`, `.env`,
  `*.log`, `.DS_Store`, `.vault`, `scratch/`, `wrangler.toml`. Verified: none of `node_modules/`,
  `dist/`, `.wrangler/` are tracked (`git ls-files | grep -E '^(node_modules|dist|\.wrangler)/'`
  returns nothing). There is no separate `caption-wars/.gitignore`; the root file covers the whole
  repo, confirmed by the same check run from repo root.
- `git ls-files | wc -l` = **76**.
- Scanned `git ls-files` for secret-looking names (`.env`, `.dev.vars`, `secret`, `.pem`, `.key`,
  `credential`): none found.

## Not touched (per instructions)

`caption-wars/src`, `caption-wars/tests`, `caption-wars/scripts`, `caption-wars/wrangler.jsonc`
were not read for editing purposes and not modified; another agent owns those.

## Could not verify

- Whether `joydai2026-del` should instead carry a real legal name on the LICENSE: not provided,
  left as the GitHub account name per the dispatch note.
- Whether the live game currently has AI players enabled by default (the README's "two AI players
  are in by default" line reflects the documented `botCount` default of 2 in
  `caption-wars/README.md`'s Configuration table, not a fresh live check of the deployed room
  defaults).
