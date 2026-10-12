// Payment adapters. Card data never touches this app: Stripe Checkout collects it.
// Contract (proposal option A): authorize at checkout, capture when the café accepts,
// void automatically if the café rejects.
import { DomainError } from "./domain";
import type { Env } from "./http";

export function stripeEnabled(env: Env) {
  return !!env.STRIPE_SECRET_KEY;
}

export function demoEnabled(env: Env) {
  return env.DEMO_MODE === "true";
}

function form(data: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.append(k, String(v));
  return p;
}

async function stripe<T>(env: Env, method: string, path: string, data?: Record<string, string | number | undefined>, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (data) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: data ? form(data) : undefined });
  const json = (await res.json()) as T & { error?: { message: string; code?: string } };
  if (!res.ok) throw new DomainError("PAYMENT_PROVIDER", json.error?.message ?? "The payment provider returned an error.", 502, { providerCode: json.error?.code });
  return json;
}

export interface StripeSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  payment_intent: string | null;
}

export async function createCheckoutSession(
  env: Env,
  args: { orderId: string; orderNumber: string; amountCents: number; email: string; appUrl: string; cafeName: string },
) {
  return stripe<StripeSession>(
    env,
    "POST",
    "checkout/sessions",
    {
      mode: "payment",
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": args.amountCents,
      "line_items[0][price_data][product_data][name]": `${args.cafeName} · Order ${args.orderNumber}`,
      "payment_intent_data[capture_method]": "manual",
      "payment_intent_data[metadata][order_id]": args.orderId,
      client_reference_id: args.orderId,
      "metadata[order_id]": args.orderId,
      customer_email: args.email,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${args.appUrl}/order/${args.orderId}?checkout=return`,
      cancel_url: `${args.appUrl}/order/${args.orderId}?checkout=cancel`,
    },
    `session-${args.orderId}`,
  );
}

export const getCheckoutSession = (env: Env, id: string) => stripe<StripeSession>(env, "GET", `checkout/sessions/${id}`);
export const expireCheckoutSession = (env: Env, id: string) => stripe<StripeSession>(env, "POST", `checkout/sessions/${id}/expire`, {});

export const capturePayment = (env: Env, paymentIntent: string, orderId: string) =>
  stripe<{ id: string; status: string }>(env, "POST", `payment_intents/${paymentIntent}/capture`, {}, `capture-${orderId}`);

export const voidPayment = (env: Env, paymentIntent: string, orderId: string) =>
  stripe<{ id: string; status: string }>(env, "POST", `payment_intents/${paymentIntent}/cancel`, {}, `void-${orderId}`);

export const refundPayment = (env: Env, paymentIntent: string, amountCents: number, refundId: string) =>
  stripe<{ id: string; status: string }>(env, "POST", "refunds", { payment_intent: paymentIntent, amount: amountCents }, `refund-${refundId}`);

/** Verifies a Stripe webhook signature (v1 scheme) with a 5 minute replay tolerance. */
export async function verifyStripeSignature(payload: string, header: string | undefined, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
