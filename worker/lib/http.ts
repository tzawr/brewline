import type { Context } from "hono";
import { DomainError } from "./domain";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEMO_MODE?: string;
  APP_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "customer" | "barista" | "manager";
  marketing_opt_in: number;
  created_at: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User | null; correlationId: string } };
export type Ctx = Context<AppEnv>;

export const nowIso = () => new Date().toISOString();

export function newId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18)}`;
}

export function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable error envelope: code, safe message, retryable flag, correlation id. */
export function fail(c: Ctx, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json(
    { error: { code, message, retryable: status >= 500 || status === 429, correlationId: c.get("correlationId"), ...extra } },
    status as 400,
  );
}

export function handleError(err: unknown, c: Ctx) {
  if (err instanceof DomainError) return fail(c, err.status, err.code, err.message, err.details ? { details: err.details } : {});
  console.error(JSON.stringify({ correlationId: c.get("correlationId"), error: String(err), stack: (err as Error)?.stack }));
  return fail(c, 500, "INTERNAL", "Something went wrong on our side. Please try again.");
}

export function requireUser(c: Ctx): User {
  const u = c.get("user");
  if (!u) throw new DomainError("AUTH_REQUIRED", "Please sign in to continue.", 401);
  return u;
}

export function requireRole(c: Ctx, ...roles: User["role"][]): User {
  const u = requireUser(c);
  if (!roles.includes(u.role)) throw new DomainError("FORBIDDEN", "You don't have access to this.", 403);
  return u;
}

export async function body<T>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new DomainError("BAD_REQUEST", "The request body must be valid JSON.");
  }
}

export function str(v: unknown, field: string, { min = 1, max = 200 } = {}): string {
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new DomainError("VALIDATION", `Please enter a valid ${field}.`, 400, { field });
  return v.trim();
}

export function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new DomainError("VALIDATION", `${field} must be between ${min} and ${max}.`, 400, { field });
  return v;
}

export async function audit(db: D1Database, actorId: string, action: string, target: string, detail: unknown) {
  await db.prepare("INSERT INTO audit_log (actor_id, action, target, detail) VALUES (?,?,?,?)").bind(actorId, action, target, JSON.stringify(detail)).run();
}
