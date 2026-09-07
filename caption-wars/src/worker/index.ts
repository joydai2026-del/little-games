// Worker entry point. This is a placeholder: the real /api/* router (rooms,
// join, start, caption, vote, next, polling) and the real RoomDO (persistence
// + bots + alarms) are built separately per docs/plans/2026-09-07-mvp-plan.md,
// item B. This file only keeps `npm run build` / `wrangler dev` / typecheck
// green in the meantime, and documents the two bindings every real handler
// will need (AI, ROOMS).

export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  ROOMS: DurableObjectNamespace;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      return json({ error: 'not implemented yet' }, 501);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * Stub Durable Object, one per room code (see wrangler.jsonc: binding ROOMS).
 * The real implementation (state persistence, bot orchestration, alarms) is
 * built per the plan; this only makes the binding resolvable and typecheck.
 */
export class RoomDO implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env
  ) {
    void this.ctx;
    void this.env;
  }

  async fetch(_request: Request): Promise<Response> {
    return json({ error: 'not implemented yet' }, 501);
  }
}
