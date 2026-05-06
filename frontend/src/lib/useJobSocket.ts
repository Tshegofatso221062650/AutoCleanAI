"use client";
/**
 * useJobSocket — connects to /ws/jobs and delivers real-time events.
 *
 * Usage:
 *   const { events, connected } = useJobSocket();
 *
 * Events shape:
 *   { event: "job_update",   job_id, job_name, status, message }
 *   { event: "batch_update", batch_id, status, completed, failed, total }
 *   { event: "connected",    username }
 *   { event: "ping" | "pong" }
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { getToken } from "./api";

const WS_BASE =
  (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000")
    .replace(/^http/, "ws");

export type JobEvent = {
  event: string;
  job_id?: number;
  job_name?: string;
  batch_id?: number;
  status?: string;
  message?: string;
  completed?: number;
  failed?: number;
  total?: number;
  username?: string;
};

const MAX_EVENTS = 50;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECTS   = 10;

export function useJobSocket() {
  const [events, setEvents]     = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef       = useRef<WebSocket | null>(null);
  const reconnects  = useRef(0);
  const unmounted   = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    const token = getToken();
    const url   = `${WS_BASE}/ws/jobs${token ? `?token=${token}` : ""}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnects.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const msg: JobEvent = JSON.parse(e.data as string);
        if (msg.event === "ping") {
          ws.send(JSON.stringify({ type: "ping" }));
          return;
        }
        // Suppress protocol / handshake noise — only store real job events
        if (msg.event === "pong" || msg.event === "connected") return;
        setEvents((prev) => [msg, ...prev].slice(0, MAX_EVENTS));
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!unmounted.current && reconnects.current < MAX_RECONNECTS) {
        reconnects.current += 1;
        setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
