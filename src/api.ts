export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any, public retryable = false) {
    super(message);
  }
}

export const surface = () => (/^\/(barista|manager)(\/|$)/.test(window.location.pathname) ? "staff" : "customer");

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Surface": surface() },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.", undefined, true);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "ERROR", err.message ?? "Something went wrong.", err.details, !!err.retryable);
  }
  return data as T;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
