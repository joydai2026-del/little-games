// Cloudflare Access in front of /admin/*, verified by the hub itself: the
// Cf-Access-Jwt-Assertion must be signed by the team's keys, from the team
// issuer, for this application's AUD tag. Any of the three missing in config
// means every admin request is refused (fail closed).
import type { Policy } from '../config';
import { verifyRs256 } from './jwt';

export async function accessActor(req: Request, p: Policy, nowMs: number): Promise<string | null> {
  if (!p.accessJwksUrl || !p.accessIssuer || !p.accessAud) return null;
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  const payload = await verifyRs256(token, { jwksUrl: p.accessJwksUrl, issuers: [p.accessIssuer], audience: p.accessAud, nowMs });
  if (!payload) return null;
  const who = payload.email ?? payload.common_name ?? payload.sub;
  return typeof who === 'string' && who ? who : null;
}
