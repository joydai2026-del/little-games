// BudgetDO: ONE Durable Object ("global") that counts paid speech calls per
// UTC day for the whole game. Every model call reserves one unit first; when
// the day's limit is reached, reservations are refused (the caller fails
// closed). GET read returns the day's count for the readback route.
import { utcDay } from './env';

interface Day {
  day: string;
  used: number;
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
    if (!this.current || this.current.day !== day) this.current = { day, used: 0 };
    return this.current;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const d = this.today(Date.now());
    const limit = Math.max(0, Math.trunc(Number(url.searchParams.get('limit'))));
    if (url.pathname === '/reserve') {
      if (!Number.isFinite(limit) || d.used + 1 > limit) return Response.json({ ok: false, day: d.day, used: d.used, limit });
      this.current = { day: d.day, used: d.used + 1 };
      await this.ctx.storage.put('day', this.current);
      return Response.json({ ok: true, day: d.day, used: this.current.used, limit });
    }
    return Response.json({ day: d.day, used: d.used });
  }
}
