import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { DomainError } from "./domain";
import { b64url, sha256, type Ctx, type User } from "./http";

// Customer app and staff screens keep separate sessions, so a barista tablet (or a demo visitor
// with both open) never signs the other surface out.
const cookieName = (c: Ctx) => (c.req.header("x-surface") === "staff" ? "bl_staff" : "bl_session");
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto maximum

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter));
  const expected = fromB64url(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function createSession(c: Ctx, userId: string) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)")
    .bind(await sha256(token), userId, expires.toISOString())
    .run();
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires,
  });
}

export async function loadUser(c: Ctx): Promise<User | null> {
  const token = getCookie(c, cookieName(c));
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.marketing_opt_in, u.created_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<User>();
  return row ?? null;
}

export async function destroySession(c: Ctx) {
  const token = getCookie(c, cookieName(c));
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, cookieName(c), { path: "/" });
}

/** Fixed-window limiter backed by D1: `limit` attempts per `windowSec` for a key. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSec: number) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start < ?2 - ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start < ?2 - ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, now, windowSec)
    .first<{ count: number }>();
  if (row && row.count > limit) throw new DomainError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.", 429);
}
