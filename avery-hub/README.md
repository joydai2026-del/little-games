# avery-hub

Sign-in with Google, the teacher database and the free/paid gate for every Avery Studio game.
Games never touch teacher data directly; they call the `HubService` entrypoint through a service binding.
Game-side wiring: [`docs/HUB-API.md`](docs/HUB-API.md).

| Folder | What is in it |
|---|---|
| `src/` | the Worker: public routes, `HubService`, Durable Objects |
| `src/db/` | the only code that touches the database |
| `src/auth/` | Google sign-in, hub sessions, the hand-off token |
| `src/rpc/` | `HubService`, the only door games use |
| `src/admin/` | JJ's tools behind Cloudflare Access |
| `migrations/` | numbered, additive D1 migrations |
| `public/` | brand kit copies (theme, Momo) |
| `tests/` | vitest, run with `npm test` |
| `docs/` | API guide and ops runbooks |
