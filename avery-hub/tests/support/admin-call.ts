import { accessToken, HUB, type Hub } from './harness';

export async function adminPost(h: Hub, path: string, body: unknown, token?: string) {
  return h.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token === undefined ? { 'Cf-Access-Jwt-Assertion': await accessToken(h) } : token ? { 'Cf-Access-Jwt-Assertion': token } : {}) },
    body: JSON.stringify(body),
  });
}

export function revokeAccessForTest(h: Hub, teacherId: string) {
  return adminPost(h, '/admin/revoke-access', { teacherId, reason: 'test' });
}
export { HUB };
