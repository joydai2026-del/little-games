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
  jwks: { negativeMs: number; backoffMs: number; backoffMaxMs: number; minRefreshMs: number; negativeMax: number };
  hashKeyCurrent: number;
  sessionIdleMs: number;
  sessionMaxMs: number;
  sessionRotateMs: number;
  sessionRotateOverlapMs: number;
  gameSessionMaxMs: number;
  gameSessionIdleMs: number;
  handoffMs: number;
  oauthStateMs: number;
  maxDevices: number;
  roomPassMs: number;
  freeTierEnabled: boolean;
  /** Days a seat grant is kept after it ends; null = invalid config (the clean-up refuses to run). */
  seatGrantRetentionDays: number | null;
  dbReady: boolean;
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

/**
 * A whole number in [min, max]; `fallback` only when the var is absent. Present
 * but empty, not a number, fractional or out of range = null (fail closed).
 */
function boundedInt(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
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
    // Floors so a zero or negative value cannot switch the protections off.
    jwks: {
      negativeMs: Math.max(1, num(env, 'JWKS_NEGATIVE_CACHE_SECONDS', 60)) * 1000,
      backoffMs: Math.max(1, num(env, 'JWKS_RETRY_BACKOFF_SECONDS', 30)) * 1000,
      backoffMaxMs: Math.max(1, num(env, 'JWKS_RETRY_BACKOFF_MAX_SECONDS', 600)) * 1000,
      minRefreshMs: Math.max(1, num(env, 'JWKS_MIN_REFRESH_SECONDS', 10)) * 1000,
      negativeMax: Math.max(1, num(env, 'JWKS_NEGATIVE_CACHE_MAX', 256)),
    },
    hashKeyCurrent: num(env, 'SESSION_HASH_KEY_CURRENT', 1),
    sessionIdleMs: num(env, 'SESSION_IDLE_DAYS', 30) * DAY,
    sessionMaxMs: num(env, 'SESSION_MAX_DAYS', 90) * DAY,
    sessionRotateMs: num(env, 'SESSION_ROTATE_DAYS', 7) * DAY,
    sessionRotateOverlapMs: num(env, 'SESSION_ROTATE_OVERLAP_SECONDS', 30) * 1000,
    gameSessionMaxMs: num(env, 'GAME_SESSION_HOURS', 12) * HOUR,
    gameSessionIdleMs: num(env, 'GAME_SESSION_IDLE_HOURS', 4) * HOUR,
    handoffMs: num(env, 'HANDOFF_TOKEN_SECONDS', 60) * 1000,
    oauthStateMs: num(env, 'OAUTH_STATE_SECONDS', 600) * 1000,
    maxDevices: num(env, 'MAX_TEACHER_DEVICES', 3),
    roomPassMs: num(env, 'ROOM_PASS_HOURS', 4) * HOUR,
    // JJ 2026-09-29: no free tier (one free round per game lives in each game).
    freeTierEnabled: str(env, 'FREE_TIER_ENABLED', 'false') === 'true',
    // Production ships with a placeholder D1 id and DB_READY "false"; the Worker refuses to serve until both are set.
    dbReady: str(env, 'DB_READY', 'false') === 'true',
    seatGrantRetentionDays: boundedInt(env.SEAT_GRANT_RETENTION_DAYS, 400, 30, 3650),
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

/** Lists an unpaid teacher may keep visible: FREE_LIST_LIMIT with the free tier on, else none. */
export function freeListAllowance(p: Policy): number {
  return p.freeTierEnabled ? p.freeListLimit : 0;
}
