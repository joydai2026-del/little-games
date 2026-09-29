// avery-hub Worker. The default export serves PUBLIC routes only:
//   /healthz, /auth/*, /me, /me/export, /me/delete, /admin/* (Access),
//   /billing/* and /stripe/webhook (501 until S2b).
// There is no /internal/* route. Games reach teacher data only through the
// named HubService entrypoint (service binding), exported below.
import type { Env } from './env';
import { policy } from './config';
import { authCallback, authDevices, authSignOut, authStart } from './auth/flow';
import { meDelete, meExport, mePage } from './routes/me';
import { adminRoute } from './admin/routes';
import { cantSignIn, page } from './pages/layout';
import { runCleanup } from './cleanup';

export { TokenDO } from './do/token-do';
export { BillingDO } from './do/billing-do';
export { HubService } from './rpc/hub-service';
import { ALERT_TAG } from './alert';

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const p = policy(env);
  // Production ships with a placeholder D1 id and DB_READY "false": refuse to
  // serve anything until the real database is bound and DB_READY is "true".
  if (!p.dbReady) {
    return Response.json({ ok: false, error: 'database_not_configured', version: p.version }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (path === '/healthz') return Response.json({ ok: true, version: p.version }, { headers: { 'Cache-Control': 'no-store' } });
  if (path === '/' ) return Response.redirect(new URL('/me', url).toString(), 302);
  if (path === '/auth/start' && method === 'GET') return authStart(request, env);
  if (path === '/auth/callback' && method === 'GET') return authCallback(request, env);
  if (path === '/auth/devices' && method === 'POST') return authDevices(request, env);
  if (path === '/auth/signout' && method === 'POST') return authSignOut(request, env, false);
  if (path === '/auth/signout-everywhere' && method === 'POST') return authSignOut(request, env, true);
  if (path === '/me' && method === 'GET') return mePage(request, env);
  if (path === '/me/export' && method === 'GET') return meExport(request, env);
  if (path === '/me/delete' && method === 'POST') return meDelete(request, env);
  if (path === '/admin' || path.startsWith('/admin/')) return adminRoute(request, env, path);
  if (path === '/stripe/webhook' || path === '/billing' || path.startsWith('/billing/')) {
    // TODO(S2b): Checkout, portal and the Stripe webhook.
    return page('Coming soon', `<h1>Not open yet</h1><div class="card"><p>Subscriptions are not open yet.</p></div>`, {
      status: 501,
      supportEmail: policy(env).supportEmail,
    });
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (e) {
      // Never leak a stack. Sign-in paths get the plain sign-in message.
      console.error('hub error', e instanceof Error ? e.message : String(e));
      const path = new URL(request.url).pathname;
      if (path.startsWith('/auth/')) return cantSignIn(policy(env).supportEmail);
      return new Response('Something went wrong. Please try again.', { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      const r = await runCleanup(env);
      console.log('cleanup', JSON.stringify(r));
    } catch (e) {
      console.error(`${ALERT_TAG} cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
} satisfies ExportedHandler<Env>;
