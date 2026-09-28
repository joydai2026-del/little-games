// Types for agent/lib.mjs so the TypeScript tests can drive it.
export function seededRandom(seed?: number): () => number;
export function firstChar(word: string): string;
export interface AgentClient {
  readonly auth: { playerId: string; playerSecret: string } | null;
  create(name: string, text: string, options?: Record<string, unknown>): Promise<any>;
  join(code: string, name: string): Promise<any>;
  state(code: string, version?: number): Promise<any>;
  drawing(code: string): Promise<any>;
  strokes(char: string): Promise<any>;
  guess(code: string, race: number, question: number, seq: number, card: number): Promise<any>;
  start(code: string): Promise<any>;
  next(code: string): Promise<any>;
}
export function createClient(opts: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): AgentClient;
export function matchingCards(drawing: { strokes: string[] }, cardData: ({ strokes: string[] } | null)[]): number[];
export function planGuess(
  state: any,
  drawing: any,
  cardData: ({ strokes: string[] } | null)[],
  opts?: { patience?: number; mistakeRate?: number; random?: () => number }
): { race: number; question: number; seq: number; card: number } | null;
export function playRound(opts: {
  client: AgentClient;
  code: string;
  name: string;
  pollMs?: number;
  patience?: number;
  mistakeRate?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  maxSteps?: number;
}): Promise<{ right: number; wrong: number; points: number; place: number | null; phase: string }>;
