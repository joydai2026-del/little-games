// Types for agent/lib.mjs so the TypeScript tests can drive it.
export function seededRandom(seed?: number): () => number;
export interface AgentClient {
  readonly auth: { playerId: string; playerSecret: string } | null;
  create(name: string, text: string, options?: Record<string, unknown>): Promise<any>;
  join(code: string, name: string): Promise<any>;
  state(code: string, version?: number): Promise<any>;
  stroke(code: string, race: number, seq: number, turn: number, points: [number, number][]): Promise<any>;
  strokes(char: string): Promise<{ strokes: string[]; medians: number[][][] }>;
  start(code: string): Promise<any>;
  next(code: string): Promise<any>;
}
export function createClient(opts: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AgentClient;
export function findMissing(full: { strokes: string[] } | null, visible: string[]): number;
export function planStroke(state: any, full: { strokes: string[]; medians: number[][][] } | null, opts?: { random?: () => number; mistakeRate?: number; thinkMs?: number }): {
  race: number;
  seq: number;
  turn: number;
  points: [number, number][];
  kind: 'right' | 'miss';
  char: string;
  stroke: number;
} | null;
export function waitFor(state: any, opts?: { thinkMs?: number; minMs?: number; idleMs?: number }): number;
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
}): Promise<{ rights: number; mistakes: number; wins: number; place: number | null; phase: string }>;
