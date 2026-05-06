type ConfirmRequest = { message: string; resolve: (ok: boolean) => void };

const listeners = new Set<(req: ConfirmRequest) => void>();

export function _registerConfirmListener(cb: (req: ConfirmRequest) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function showConfirm(message: string): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    for (const cb of listeners) cb({ message, resolve });
  });
}
