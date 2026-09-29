// avery-hub Worker. The default export serves public routes only; games reach
// teacher data through the named HubService entrypoint (service binding).
import type { Env } from './env';

export { TokenDO } from './do/token-do';
export { BillingDO } from './do/billing-do';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, version: String(env.HUB_VERSION ?? 'unknown') });
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
