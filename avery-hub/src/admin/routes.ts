// The owner's admin tools. Reachable only as /admin/* with a Cloudflare Access token the hub
// verifies itself; every action is written to admin_log. Agent-callable with
// an Access service token (JSON in, JSON out). Nothing teacher-facing imports
// this module (tests/structure.test.ts).
import type { Env } from '../env';
import { policy } from '../config';
import { openDb } from '../db';
import { adminGrantAccess, adminGrantSeats, adminMoveTeacher, adminRevokeAccess } from '../db/admin-ops';
import { accessActor } from '../auth/access';
import { now } from '../clock';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function when(v: unknown): number | null {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

export async function adminRoute(req: Request, env: Env, path: string): Promise<Response> {
  const p = policy(env);
  const actor = await accessActor(req, p, now());
  if (!actor) return json({ ok: false, error: 'forbidden' }, 403);
  if (req.method !== 'POST') return json({ ok: false, error: 'post_only' }, 405);
  // A browser form from another site carries its Origin; the admin CLI sends none.
  const origin = req.headers.get('Origin');
  if (origin && origin !== p.hubOrigin) return json({ ok: false, error: 'forbidden' }, 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'bad_json' }, 400);
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  if (!reason) return json({ ok: false, error: 'reason_required' }, 400);
  const db = openDb(env);
  const t = now();
  switch (path) {
    case '/admin/grant-access': {
      const until = when(body.until);
      if (typeof body.teacherId !== 'string' || !until) return json({ ok: false, error: 'bad_input' }, 400);
      return json({ ok: await adminGrantAccess(db, actor, body.teacherId, until, reason, t) });
    }
    case '/admin/revoke-access': {
      if (typeof body.teacherId !== 'string') return json({ ok: false, error: 'bad_input' }, 400);
      return json({ ok: await adminRevokeAccess(db, actor, body.teacherId, reason, t) });
    }
    case '/admin/move-teacher': {
      if (typeof body.fromTeacherId !== 'string' || typeof body.toTeacherId !== 'string') return json({ ok: false, error: 'bad_input' }, 400);
      const r = await adminMoveTeacher(db, actor, body.fromTeacherId, body.toTeacherId, reason, t);
      return json({ ok: r === 'ok', result: r }, r === 'ok' ? 200 : 409);
    }
    case '/admin/grant-seats': {
      const until = when(body.until);
      const emails = Array.isArray(body.emails) ? body.emails.filter((e): e is string => typeof e === 'string' && /^[^@\s]+@[^@\s]+$/.test(e)) : [];
      if (!until || emails.length === 0 || typeof body.school !== 'string' || !body.school.trim()) return json({ ok: false, error: 'bad_input' }, 400);
      return json({ ok: true, seats: await adminGrantSeats(db, actor, emails, until, body.school.trim(), t) });
    }
    default:
      return json({ ok: false, error: 'not_found' }, 404);
  }
}
