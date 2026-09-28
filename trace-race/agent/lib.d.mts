// Types for agent/lib.mjs so the TypeScript tests can drive it.
export function seededRandom(seed?: number): () => number;
export interface AgentClient {
  readonly auth: { playerId: string; playerSecret: string } | null;
  create(name: string, text: string, options?: Record<string, unknown>): Promise<any>;
  join(code: string, name: string): Promise<any>;
  state(code: string, version?: number): Promise<any>;
  stroke(code: string, charIndex: number, strokeIndex: number, result: 'correct' | 'mistake'): Promise<any>;
  start(code: string): Promise<any>;
  next(code: string): Promise<any>;
}
export function createClient(opts: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AgentClient;
export function planStroke(state: any, opts?: { random?: () => number; mistakeRate?: number }): {
  charIndex: number;
  strokeIndex: number;
  result: 'correct' | 'mistake';
  char: string;
} | null;
export function playRace(opts: {
  client: AgentClient;
  code: string;
  name: string;
  paceMs?: number;
  mistakeRate?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  maxSteps?: number;
}): Promise<{ strokes: number; mistakes: number; charsDone: number; place: number | null; phase: string }>;
