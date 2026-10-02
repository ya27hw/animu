<script lang="ts">
  import { toasts, dismiss } from '../lib/toast.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
  {#each toasts as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'bad' ? 'alert' : 'status'}>
      <span class="ic" aria-hidden="true"><Icon name={t.kind === 'ok' ? 'check' : t.kind === 'bad' ? 'alert' : 'info'} size={16} stroke={2.2} /></span>
      <span class="sr-only">{t.kind === 'ok' ? 'Success: ' : t.kind === 'bad' ? 'Error: ' : 'Notification: '}</span>
      <span class="msg">{t.message}</span>
      <button class="icon-btn sm" onclick={() => dismiss(t.id)} aria-label="Dismiss notification"><Icon name="x" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; z-index: 10000; right: 18px; bottom: 18px; display: grid; gap: 10px; width: min(380px, calc(100vw - 36px)); pointer-events: none; }
  .toast {
    pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 11px 8px 11px 12px;
    background: var(--surface-2); border: 1px solid var(--line-strong); border-radius: 12px; box-shadow: var(--shadow-2);
    animation: pop 0.36s var(--ease);
  }
  .msg { flex: 1; font-size: 13.5px; line-height: 1.4; }
  .ic { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--info-soft); color: var(--info); flex: none; }
  .ok .ic { background: var(--ok-soft); color: var(--ok); }
  .bad .ic { background: var(--bad-soft); color: var(--bad); }
  @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
  @media (max-width: 720px) { .toasts { right: 12px; left: 12px; width: auto; bottom: calc(var(--tab-h) + 14px + env(safe-area-inset-bottom)); } }
</style>
