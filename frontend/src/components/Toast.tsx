"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertCircle, Info, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

type ToastData = { message: string; type: ToastType; duration?: number };
type ToastListener = (toasts: Map<number, ToastData>) => void;

export function Toast({ message, type, duration = 3000, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-accent" />,
    error: <XCircle className="w-5 h-5 text-danger" />,
    warning: <AlertCircle className="w-5 h-5 text-warn" />,
    info: <Info className="w-5 h-5 text-accent2" />,
  };

  const colors = {
    success: "bg-accent/10 border-accent/30",
    error: "bg-danger/10 border-danger/30",
    warning: "bg-warn/10 border-warn/30",
    info: "bg-accent2/10 border-accent2/30",
  };

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-3 p-4 rounded-xl border ${colors[type]} backdrop-blur-xl transition-all duration-300 ${
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"
      }`}
    >
      {icons[type]}
      <p className="text-sm text-app-text">{message}</p>
      <Button
        onClick={onClose}
        type="button"
        variant="ghost"
        size="sm"
        className="p-1 rounded-lg hover:bg-edge/50 text-app-muted hover:text-app-text transition-colors"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

let toastId = 0;
const toasts = new Map<number, ToastData>();
const listeners = new Set<ToastListener>();

export function showToast(message: string, type: ToastType = "info", duration?: number) {
  const id = toastId++;
  toasts.set(id, { message, type, duration });
  listeners.forEach((listener) => listener(new Map(toasts)));
  setTimeout(() => {
    toasts.delete(id);
    listeners.forEach((listener) => listener(new Map(toasts)));
  }, duration || 3000);
  return id;
}

export function useToasts() {
  const [currentToasts, setCurrentToasts] = useState<Map<number, ToastData>>(new Map(toasts));

  useEffect(() => {
    const listener: ToastListener = (newToasts) => {
      setCurrentToasts(new Map(newToasts));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    toasts: currentToasts,
    showToast,
    removeToast: (id: number) => {
      toasts.delete(id);
      listeners.forEach((listener) => listener(new Map(toasts)));
    },
  };
}
