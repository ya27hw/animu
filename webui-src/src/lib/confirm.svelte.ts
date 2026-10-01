export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export const confirmState = $state<{ open: boolean; req: ConfirmRequest | null }>({ open: false, req: null });
let resolver: ((v: boolean) => void) | null = null;

export function ask(req: ConfirmRequest): Promise<boolean> {
  confirmState.req = req;
  confirmState.open = true;
  return new Promise((resolve) => { resolver = resolve; });
}

export function answer(v: boolean): void {
  confirmState.open = false;
  resolver?.(v);
  resolver = null;
}
