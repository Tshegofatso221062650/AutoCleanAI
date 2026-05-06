const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const inFlightGetRequests = new Map<string, Promise<unknown>>();
const getResponseCache = new Map<string, CacheEntry>();
const DEFAULT_GET_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 200;

/**
 * Synchronously return cached data for `path` if it exists and has not expired.
 * Returns `null` when the cache is empty or stale.
 * Use this to initialise component state so pages render content on the first
 * paint rather than showing a loading spinner when data is already available.
 */
export function getCached<T = unknown>(path: string): T | null {
  const url = `${API_BASE}${path}`;
  const now = Date.now();
  const entry = getResponseCache.get(url);
  if (entry && entry.expiresAt > now) return entry.value as T;
  return null;
}

export async function getAuthStatus(): Promise<{ disable_auth: boolean }> {
  const res = await fetch(`${API_BASE}/auth/status`);
  if (!res.ok) return { disable_auth: false };
  return res.json() as Promise<{ disable_auth: boolean }>;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("autoclean_token");
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await res.json();
      if (body?.detail) return String(body.detail);
      if (body?.message) return String(body.message);
      return JSON.stringify(body);
    }
    const text = await res.text();
    return text || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  const t = getToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const url = `${API_BASE}${path}`;

  if (method === "GET") {
    const now = Date.now();
    const cached = getResponseCache.get(url);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const inFlight = inFlightGetRequests.get(url);
    if (inFlight) {
      return inFlight;
    }
  }

  const requestPromise = (async () => {
    let res: Response;
    try {
      res = await fetch(url, { ...init, method, headers });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(0, "Cannot reach the server. Check your connection.");
    }

    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        if (typeof window !== "undefined") {
          // Dynamically import to avoid circular dependency
          import("@/components/AuthGate").then(({ invalidateAuthCache }) => invalidateAuthCache());
          window.location.href = "/login";
        }
        throw new ApiError(401, "Session expired. Please log in again.");
      }
      const message = await parseErrorMessage(res);
      throw new ApiError(res.status, message);
    }

    const ct = res.headers.get("content-type") || "";
    const parsed = ct.includes("application/json") ? await res.json() : await res.text();

    if (method === "GET") {
      getResponseCache.set(url, { expiresAt: Date.now() + DEFAULT_GET_TTL_MS, value: parsed });
      // Evict oldest entries when the cache grows too large
      if (getResponseCache.size > MAX_CACHE_ENTRIES) {
        const oldest = getResponseCache.keys().next().value;
        if (oldest) getResponseCache.delete(oldest);
      }
    } else {
      // Targeted invalidation: only evict cache entries related to the mutated
      // resource so unrelated pages (pipelines, validation, etc.) stay fast.
      // Fall back to clearing everything when the mutation path is unknown.
      const mutationPath = path.split("?")[0];
      const ALWAYS_INVALIDATE = ["/history", "/datasets", "/dataset", "/analytics", "/clean", "/analyze"];
      const shouldInvalidateAll = ALWAYS_INVALIDATE.some((p) => mutationPath.startsWith(p));
      if (shouldInvalidateAll) {
        // Clear dataset-related entries only
        for (const key of Array.from(getResponseCache.keys())) {
          if (
            key.includes("/history") ||
            key.includes("/dataset") ||
            key.includes("/analytics") ||
            key.includes("/clean") ||
            key.includes("/analyze") ||
            key.includes("/reports")
          ) {
            getResponseCache.delete(key);
          }
        }
      } else {
        // For mutations on other resources (pipelines, validation rules, etc.)
        // only evict entries that share the same base path
        for (const key of Array.from(getResponseCache.keys())) {
          if (key.includes(mutationPath)) {
            getResponseCache.delete(key);
          }
        }
      }
    }

    return parsed;
  })();

  if (method === "GET") {
    inFlightGetRequests.set(url, requestPromise);
    // .finally() returns a NEW rejected promise — add .catch() to silence the
    // secondary unhandledrejection it would otherwise fire.
    requestPromise.finally(() => {
      inFlightGetRequests.delete(url);
    }).catch(() => {});
  }

  return requestPromise;
}

export async function apiFetchAsync<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch(path, init) as Promise<T>;
}

export function setToken(t: string) {
  localStorage.setItem("autoclean_token", t);
}

export function clearToken() {
  localStorage.removeItem("autoclean_token");
}

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}
