"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getAuthStatus, getToken } from "@/lib/api";

/**
 * Module-level cache: only one network request to /auth/status per session.
 * null  = not yet fetched
 * true  = auth is disabled (everyone is allowed)
 * false = auth is enabled (token required)
 */
let disableAuthCache: boolean | null = null;
let authCheckInFlight: Promise<boolean> | null = null;

async function fetchDisableAuth(): Promise<boolean> {
  if (disableAuthCache !== null) return disableAuthCache;
  if (authCheckInFlight) return authCheckInFlight;

  authCheckInFlight = getAuthStatus()
    .then((s) => {
      disableAuthCache = s.disable_auth;
      return s.disable_auth;
    })
    .catch(() => {
      disableAuthCache = false;
      return false;
    })
    .finally(() => {
      authCheckInFlight = null;
    });

  return authCheckInFlight;
}

/** Call on logout so the next navigation re-evaluates. */
export function invalidateAuthCache() {
  disableAuthCache = null;
}

/** Synchronously decide if auth is ok without any network call. */
function isAuthOkSync(): boolean {
  if (disableAuthCache === true) return true;
  if (disableAuthCache === false) return !!getToken();
  return false; // not yet fetched — must wait for async check
}

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Start immediately as `true` if we already know auth is satisfied —
  // this eliminates the flash on every navigation after the first load.
  const [ok, setOk] = useState(() => isAuthOkSync());

  useEffect(() => {
    if (ok) return; // already resolved synchronously — nothing to do

    let cancelled = false;

    fetchDisableAuth().then((disableAuth) => {
      if (cancelled) return;
      if (disableAuth) {
        setOk(true);
        return;
      }
      const t = getToken();
      if (!t) {
        router.replace("/login");
      } else {
        setOk(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ok, router]);

  if (!ok) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--app-bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span className="text-app-muted text-xs tracking-widest uppercase">Authenticating</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
