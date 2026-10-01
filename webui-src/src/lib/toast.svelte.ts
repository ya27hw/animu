export interface Toast { id: number; message: string; kind: 'info' | 'ok' | 'bad'; }

export const toasts = $state<Toast[]>([]);
let seq = 0;

export function toast(message: string, kind: Toast['kind'] = 'info', ms = 4200): void {
  const id = ++seq;
  toasts.push({ id, message, kind });
  setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
