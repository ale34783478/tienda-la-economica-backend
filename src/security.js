import { scryptSync, randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';

// ---- Contraseñas (scrypt con sal aleatoria) ----
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- Tokens JWT (HS256) ----
const b64u = (v) => Buffer.from(v).toString('base64url');

export function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds, jti: randomUUID() }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Límite de intentos de login (en memoria) ----
export class LoginLimiter {
  constructor(max = 5, windowMs = 15 * 60 * 1000) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  blocked(key) {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.resetAt < Date.now()) { this.hits.delete(key); return false; }
    return h.count >= this.max;
  }
  fail(key) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt < now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count += 1;
  }
  reset(key) { this.hits.delete(key); }
}
