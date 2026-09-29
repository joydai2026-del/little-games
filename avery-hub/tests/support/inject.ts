// Run `hook` just before the first statement whose SQL contains `marker`
// executes: a deterministic way to land a revoke between a read and a write.
import type { Hub } from './harness';

export function injectBefore(h: Hub, marker: string, hook: () => Promise<void> | void): void {
  const db = h.db;
  let fired = false;
  const proxy = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      if (!sql.includes(marker)) return st;
      return {
        bind(...params: unknown[]) {
          const bound = st.bind(...params);
          const before = async () => {
            if (!fired) {
              fired = true;
              await hook();
            }
          };
          return {
            run: async () => (await before(), bound.run()),
            first: async (c?: string) => (await before(), bound.first(c)),
            all: async () => (await before(), bound.all()),
          };
        },
      };
    },
    batch: (s: unknown[]) => db.batch(s as never),
  };
  (h.env as unknown as { DB: unknown }).DB = proxy;
}
