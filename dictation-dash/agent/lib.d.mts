// Types for agent/lib.mjs so the TypeScript tests can drive it.
export function seededRandom(seed?: number): () => number;
export interface Move {
  race: number;
  seq: number;
  wordIndex: number;
  charIndex: number;
  strokeIndex: number;
  result: 'correct' | 'mistake';
  word: string;
}
export interface AgentClient {
  readonly auth: { playerId: string; playerSecret: string } | null;
  create(name: string, text: string, options?: Record<string, unknown>, mode?: 'class' | 'solo'): Promise<any>;
  join(code: string, name: string): Promise<any>;
  state(code: string, version?: number): Promise<any>;
  hear(code: string, round: number, index: number): Promise<{ bytes: Uint8Array; type: string | null; cache: string | null }>;
  stroke(code: string, move: Omit<Move, 'word'> & { word?: string }): Promise<any>;
  skip(code: string, race: number, seq: number, wordIndex: number): Promise<any>;
  options(code: string, options: Record<string, unknown>): Promise<any>;
  start(code: string): Promise<any>;
  next(code: string): Promise<any>;
}
export function createClient(opts: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AgentClient;
export function planStroke(state: any, opts?: { random?: () => number; mistakeRate?: number }): Move | null;
export function playRound(opts: {
  client: AgentClient;
  code: string;
  name: string;
  joined?: any;
  paceMs?: number;
  mistakeRate?: number;
  listen?: boolean;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  maxSteps?: number;
}): Promise<{ strokes: number; mistakes: number; heard: any[]; wordsDone: number; place: number | null; phase: string }>;
