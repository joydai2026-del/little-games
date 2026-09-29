// Every operational value is a var in wrangler.jsonc. Code defaults exist only
// so a missing var fails safe; changing policy never needs a source edit.
import type { Env } from './env';

export interface GameEntry {
  keyHash: string; // sha256 hex of the game's key; "" = game switched off
  returnUrls: string[];
  methods: string[];
  modes: string[];
}
export type Registry = Record<string, GameEntry>;

export interface Policy {
  version: string;
  hubOrigin: string;
  supportEmail: string;
  googleClientId: string;
  googleAuthUrl: string;
  googleTokenUrl: string;
  googleJwksUrl: string;
  googleIssuers: string[];
  accessJwksUrl: string;
  accessIssuer: string;
  accessAud: string;
  hashKeyCurrent: number;
  sessionIdleMs: number;
  sessionMaxMs: number;
  sessionRotateMs: number;
  gameSessionMaxMs: number;
  gameSessionIdleMs: number;
  handoffMs: number;
  oauthStateMs: number;
  maxDevices: number;
  roomPassMs: number;
  freeListLimit: number;
  paidListLimit: number;
  tasteRoundsPerDay: number;
  switchCooldownMs: number;
  trialDays: number;
  anonFreeRounds: string;
  freeGameChoices: string[] | 'all';
  listMaxItems: number;
  listMaxBytes: number;
  classCodeLength: number;
  registry: Registry;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && String(raw ?? '').trim() !== '' ? n : fallback;
}
function str(env: Env, key: string, fallback = ''): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw : fallback;
}

export function parseRegistry(raw: unknown): Registry {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object') return {};
  const out: Registry = {};
  for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
    const e = v as Partial<GameEntry>;
    if (!/^[a-z0-9-]{1,40}$/.test(id)) continue;
    out[id] = {
      keyHash: typeof e.keyHash === 'string' ? e.keyHash.toLowerCase() : '',
      returnUrls: Array.isArray(e.returnUrls) ? e.returnUrls.filter((u) => typeof u === 'string') : [],
      methods: Array.isArray(e.methods) ? e.methods.filter((m) => typeof m === 'string') : [],
      modes: Array.isArray(e.modes) ? e.modes.filter((m) => typeof m === 'string') : [],
    };
  }
  return out;
}

export function policy(env: Env): Policy {
  const choices = str(env, 'FREE_GAME_CHOICES', 'all').trim();
  return {
    version: str(env, 'HUB_VERSION', 'unknown'),
    hubOrigin: str(env, 'HUB_ORIGIN'),
    supportEmail: str(env, 'SUPPORT_EMAIL', 'hello@averystudio.org'),
    googleClientId: str(env, 'GOOGLE_CLIENT_ID'),
    googleAuthUrl: str(env, 'GOOGLE_AUTH_URL'),
    googleTokenUrl: str(env, 'GOOGLE_TOKEN_URL'),
    googleJwksUrl: str(env, 'GOOGLE_JWKS_URL'),
    googleIssuers: str(env, 'GOOGLE_ISSUERS').split(',').map((s) => s.trim()).filter(Boolean),
    accessJwksUrl: str(env, 'ACCESS_JWKS_URL'),
    accessIssuer: str(env, 'ACCESS_ISSUER'),
    accessAud: str(env, 'ACCESS_AUD'),
    hashKeyCurrent: num(env, 'SESSION_HASH_KEY_CURRENT', 1),
    sessionIdleMs: num(env, 'SESSION_IDLE_DAYS', 30) * DAY,
    sessionMaxMs: num(env, 'SESSION_MAX_DAYS', 90) * DAY,
    sessionRotateMs: num(env, 'SESSION_ROTATE_DAYS', 7) * DAY,
    gameSessionMaxMs: num(env, 'GAME_SESSION_HOURS', 12) * HOUR,
    gameSessionIdleMs: num(env, 'GAME_SESSION_IDLE_HOURS', 4) * HOUR,
    handoffMs: num(env, 'HANDOFF_TOKEN_SECONDS', 60) * 1000,
    oauthStateMs: num(env, 'OAUTH_STATE_SECONDS', 600) * 1000,
    maxDevices: num(env, 'MAX_TEACHER_DEVICES', 3),
    roomPassMs: num(env, 'ROOM_PASS_HOURS', 4) * HOUR,
    freeListLimit: num(env, 'FREE_LIST_LIMIT', 1),
    paidListLimit: num(env, 'PAID_LIST_LIMIT', 500),
    tasteRoundsPerDay: num(env, 'FREE_TASTE_ROUNDS_PER_DAY', 1),
    switchCooldownMs: num(env, 'FREE_MODE_SWITCH_COOLDOWN_DAYS', 5) * DAY,
    trialDays: num(env, 'TRIAL_DAYS', 0),
    anonFreeRounds: str(env, 'ANON_FREE_ROUNDS', 'unlimited'),
    freeGameChoices: choices === 'all' || choices === '' ? 'all' : choices.split(',').map((s) => s.trim()).filter(Boolean),
    listMaxItems: num(env, 'LIST_MAX_ITEMS', 200),
    listMaxBytes: num(env, 'LIST_MAX_BYTES', 65536),
    classCodeLength: num(env, 'CLASS_CODE_LENGTH', 6),
    registry: parseRegistry(env.GAME_REGISTRY),
  };
}

/** Every "<gameId>:<mode>" a free teacher may pick. */
export function freeGameKeys(p: Policy): string[] {
  const all = Object.entries(p.registry).flatMap(([g, e]) => e.modes.map((m) => `${g}:${m}`));
  if (p.freeGameChoices === 'all') return all;
  const allowed = new Set(p.freeGameChoices);
  return all.filter((k) => allowed.has(k));
}
