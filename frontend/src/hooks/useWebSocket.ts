import { useEffect, useRef, useState, useCallback } from "react";

type WebSocketMessage = {
  type: "progress" | "complete" | "error" | "status";
  data: any;
};

export function useWebSocket(url: string) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setMessages((prev) => [...prev, message]);
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e);
        }
      };

      ws.onerror = (event) => {
        setError(new Error("WebSocket error"));
        console.error("WebSocket error:", event);
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
      };
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Failed to connect"));
      setConnected(false);
    }
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const sendMessage = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket is not connected");
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connected,
    messages,
    error,
    sendMessage,
    clearMessages,
    connect,
    disconnect,
  };
}

export function useProgressWebSocket(url: string) {
  const { connected, messages, sendMessage, clearMessages } = useWebSocket(url);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    if (latestMessage) {
      switch (latestMessage.type) {
        case "progress":
          setProgress(latestMessage.data.progress || 0);
          setStatus(latestMessage.data.status || "");
          break;
        case "complete":
          setIsComplete(true);
          setProgress(100);
          setStatus(latestMessage.data.status || "Complete");
          break;
        case "error":
          setStatus(latestMessage.data.error || "Error occurred");
          break;
        case "status":
          setStatus(latestMessage.data.status || "");
          break;
      }
    }
  }, [messages]);

  return {
    connected,
    progress,
    status,
    isComplete,
    sendMessage,
    clearMessages,
  };
}
