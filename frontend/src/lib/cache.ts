import { useState, useCallback, useEffect } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class Cache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}

export const cache = new Cache();

export function useCache<T>(key: string, fetcher: () => Promise<T>, ttl?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cached = cache.get<T>(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        return cached;
      }

      const fresh = await fetcher();
      cache.set(key, fresh, ttl);
      setData(fresh);
      return fresh;
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Fetch failed"));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [key, fetcher, ttl]);

  const invalidate = useCallback(() => {
    cache.delete(key);
  }, [key]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch, invalidate };
}

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number,
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached) return cached;

  const fresh = await fetcher();
  cache.set(key, fresh, ttl);
  return fresh;
}

export function invalidatePattern(pattern: string): void {
  const keys = cache.getKeys();
  const regex = new RegExp(pattern);
  for (const key of keys) {
    if (regex.test(key)) {
      cache.delete(key);
    }
  }
}

setInterval(() => {
  cache.clearExpired();
}, 60 * 1000); // Clear expired entries every minute
