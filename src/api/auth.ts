// Cloudflare Access JWT validation middleware.
// Validates Cf-Access-Jwt-Assertion on every protected request.
// The JWT signature is verified against Cloudflare's published JWKs — trusting the cookie alone is insufficient.

import type { Env, AccessUser } from '../types.js';
import type { Context, MiddlewareHandler } from 'hono';

const CERTS_CACHE_KEY = 'cf_access_certs';
const CERTS_CACHE_TTL = 3600; // 1 hour

async function fetchJwks(teamDomain: string, cache: KVNamespace): Promise<JsonWebKey[]> {
  const cached = await cache.get(CERTS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as JsonWebKey[];
    } catch {
      // fall through to fetch
    }
  }

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch Cloudflare Access JWKs: ${resp.status}`);
  const data = await resp.json() as { keys: JsonWebKey[] };
  const keys = data.keys ?? [];
  await cache.put(CERTS_CACHE_KEY, JSON.stringify(keys), { expirationTtl: CERTS_CACHE_TTL });
  return keys;
}

function base64urlToUint8(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function verifyJwt(token: string, aud: string, jwks: JsonWebKey[]): Promise<AccessUser | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: { kid?: string; alg?: string };
  let payload: { sub?: string; email?: string; name?: string; exp?: number; aud?: string | string[] };
  try {
    header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    console.error('[auth] JWT expired or missing exp', { exp: payload.exp, now });
    return null;
  }

  // Check audience
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) {
    console.error('[auth] AUD mismatch', { tokenAud: audiences, expectedAud: aud });
    return null;
  }

  // Find matching JWK by kid
  const jwk = header.kid ? jwks.find((k: JsonWebKey & { kid?: string }) => (k as { kid?: string }).kid === header.kid) : jwks[0];
  if (!jwk) {
    console.error('[auth] No matching JWK', { tokenKid: header.kid, availableKids: jwks.map((k) => (k as { kid?: string }).kid) });
    return null;
  }

  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = base64urlToUint8(parts[2]);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signingInput);
    if (!valid) {
      console.error('[auth] Signature verification failed');
      return null;
    }
  } catch (e) {
    console.error('[auth] Crypto error during verification', e);
    return null;
  }

  if (!payload.email || !payload.sub) return null;
  return { email: payload.email, sub: payload.sub, name: payload.name };
}

export function requireAuth(env: Env): MiddlewareHandler {
  return async (c: Context, next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      return c.html('<h1>Unauthorized</h1><p>No Cloudflare Access token present. Make sure you are accessing this page through Cloudflare Access.</p>', 401);
    }

    try {
      const jwks = await fetchJwks(env.CF_TEAM_DOMAIN, env.CACHE);
      const user = await verifyJwt(token, env.CF_ACCESS_AUD, jwks);
      if (!user) {
        return c.html('<h1>Unauthorized</h1><p>Your session is invalid or expired. Please log in again.</p>', 401);
      }
      c.set('user', user);
    } catch (err) {
      console.error('JWT validation error:', err);
      return c.html('<h1>Auth Error</h1><p>Could not validate your session. Please try again.</p>', 500);
    }

    return await next();
  };
}

export function getUser(c: Context): AccessUser {
  return c.get('user') as AccessUser;
}
