// BudgetDO: ONE Durable Object ("global") that counts paid speech calls per
// UTC day for the whole game, and each IP's share of it. Every model call
// reserves one unit first; when the day's limit (or that IP's limit) is
// reached, reservations are refused and the caller fails closed. IPs are kept
// only as a salted hash, only for the current day. GET read returns the
// game's count for the readback route.
import { utcDay } from './env';

interface Day {
  day: string;
  used: number;
  /** sha-256(day + ip), shortened -> calls today. */
  byIp: Record<string, number>;
}

async function ipKey(day: string, ip: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${ip}`)));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class BudgetDO implements DurableObject {
  private current: Day | null = null;

  constructor(private readonly ctx: DurableObjectState) {
    this.ctx.blockConcurrencyWhile(async () => {
      this.current = (await this.ctx.storage.get<Day>('day')) ?? null;
    });
  }

  private today(now: number): Day {
    const day = utcDay(now);
    if (!this.current || this.current.day !== day) this.current = { day, used: 0, byIp: {} };
    this.current.byIp ??= {};
    return this.current;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/reserve') {
      const limit = Math.trunc(Number(url.searchParams.get('limit')));
      const ipLimit = Math.trunc(Number(url.searchParams.get('ipLimit')));
      const key = await ipKey(utcDay(Date.now()), url.searchParams.get('ip') ?? 'no-ip');
      // From here on no await until the counts are updated: one reservation at a time.
      const d = this.today(Date.now());
      const mine = d.byIp[key] ?? 0;
      if (!Number.isFinite(limit) || !Number.isFinite(ipLimit) || d.used + 1 > limit || mine + 1 > ipLimit) {
        return Response.json({ ok: false, day: d.day, used: d.used, limit });
      }
      this.current = { day: d.day, used: d.used + 1, byIp: { ...d.byIp, [key]: mine + 1 } };
      await this.ctx.storage.put('day', this.current);
      return Response.json({ ok: true, day: d.day, used: this.current.used, limit });
    }
    const d = this.today(Date.now());
    return Response.json({ day: d.day, used: d.used, ips: Object.keys(d.byIp).length });
  }
}
