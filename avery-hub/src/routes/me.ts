// The teacher's profile page: who she is, her free game, lists, devices,
// download, delete, sign out.
import type { Env } from '../env';
import { policy } from '../config';
import { forTeacher, openDb } from '../db';
import { now } from '../clock';
import { esc, page } from '../pages/layout';
import { clearCookie, HUB_COOKIE } from '../auth/cookies';
import { csrfToken, currentHubSession } from '../auth/hub-session';
import { signedInPost } from '../auth/flow';

function gameName(key: string | null): string {
  if (!key) return 'Not picked yet';
  const [game, mode] = key.split(':');
  const g = game.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
  return mode && mode !== 'main' ? `${g}: ${mode.replace(/-/g, ' ')}` : g;
}

export async function mePage(req: Request, env: Env): Promise<Response> {
  const p = policy(env);
  const hub = await currentHubSession(req, env, p, now()).catch(() => null);
  const headers = new Headers();
  if (!hub) {
    return page(
      'My account',
      `<h1>My account</h1><div class="card"><p>Sign in to see your saved lists and your free game.</p></div>
<a class="btn-primary" href="/auth/start">Sign in with Google</a>`,
      { supportEmail: p.supportEmail },
    );
  }
  if (hub.setCookie) headers.append('Set-Cookie', hub.setCookie);
  const scope = forTeacher(openDb(env), hub.teacherId);
  const [profile, lists, devices, paid] = await Promise.all([scope.profile(), scope.countLists(), scope.devices(now(), p.sessionIdleMs), scope.isPaid(now())]);
  if (!profile) return page('My account', `<h1>My account</h1><div class="card"><p>Please sign in again.</p></div>`, { supportEmail: p.supportEmail });
  const csrf = await csrfToken(env, hub);
  const locked = profile.free_game_locked_until && profile.free_game_locked_until > now() ? new Date(profile.free_game_locked_until).toDateString() : null;
  const deviceRows = devices
    .map((d) => `<div class="row"><span>${esc(d.browser_label)}${d.id_hash === hub.hash ? ' (this one)' : ''}</span><span class="muted">${esc(new Date(d.last_used_at).toDateString())}</span></div>`)
    .join('');
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
  return page(
    'My account',
    `<h1>My account</h1>
<div class="card">
  <div class="row"><span>Signed in as</span><b>${esc(profile.email)}</b></div>
  <div class="row"><span>Plan</span><span>${paid ? 'Full access' : 'Free'}</span></div>
  ${paid ? '' : `<div class="row"><span>Your free game</span><span>${esc(gameName(profile.free_game))}</span></div>
  <div class="row"><span>You can change it</span><span>${locked ? `after ${esc(locked)}` : 'any time'}</span></div>`}
  <div class="row"><span>Saved lists</span><span>${lists}${paid ? '' : ` of ${p.freeListLimit}`}</span></div>
</div>
<div class="card"><b>Signed in on</b>${deviceRows}</div>
<a class="btn-secondary" href="/me/export">Download my data</a>
<form method="post" action="/auth/signout">${hidden}<button class="btn-secondary" type="submit">Sign out</button></form>
<form method="post" action="/auth/signout-everywhere">${hidden}<button class="btn-secondary" type="submit">Sign out everywhere</button></form>
<form method="post" action="/me/delete">${hidden}<input type="hidden" name="step" value="1"><button class="danger" type="submit">Delete my account</button></form>
<p class="muted">Need a school invoice or purchase order? Write to <a href="mailto:${esc(p.supportEmail)}">${esc(p.supportEmail)}</a>.</p>`,
    { supportEmail: p.supportEmail, headers },
  );
}

export async function meExport(req: Request, env: Env): Promise<Response> {
  const p = policy(env);
  const hub = await currentHubSession(req, env, p, now());
  if (!hub) return new Response(null, { status: 303, headers: { Location: '/me' } });
  const data = await forTeacher(openDb(env), hub.teacherId).exportAll();
  return new Response(JSON.stringify({ exportedAt: new Date(now()).toISOString(), ...data }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="avery-studio-my-data.json"',
      'Cache-Control': 'no-store',
    },
  });
}

/** Two confirmations: step 1 shows "are you sure", step 2 (with the word typed) deletes. */
export async function meDelete(req: Request, env: Env): Promise<Response> {
  const r = await signedInPost(req, env);
  if ('error' in r) return r.error!;
  const step = String(r.form?.get('step') ?? '');
  const csrf = await csrfToken(env, r.hub);
  if (step !== '2' || String(r.form?.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') {
    return page(
      'Delete my account',
      `<h1>Delete your account?</h1>
<div class="card"><p>This deletes your saved lists, classes and history, and signs you out everywhere. It cannot be undone.</p>
<p class="muted">Tip: tap "Download my data" first if you want a copy.</p></div>
<form method="post" action="/me/delete"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="step" value="2">
<label>Type DELETE to confirm<br><input name="confirm" autocomplete="off" style="font:inherit;width:100%;min-height:48px;margin:8px 0;border-radius:12px;border:2px solid var(--paper-deep);padding:0 12px"></label>
<button class="danger" type="submit">Yes, delete my account</button></form>
<a class="btn-secondary" href="/me">Keep my account</a>`,
      { supportEmail: r.p.supportEmail },
    );
  }
  await forTeacher(openDb(env), r.hub.teacherId).tombstone(now());
  return page(
    'Account deleted',
    `<h1>Your account is deleted</h1><div class="card"><p>Your lists, classes and history are gone, and every device is signed out.</p></div>`,
    { supportEmail: r.p.supportEmail, headers: { 'Set-Cookie': clearCookie(HUB_COOKIE) } },
  );
}
