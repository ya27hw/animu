<script lang="ts">
  import { confirmState, answer } from '../lib/confirm.svelte';

  import { tick } from 'svelte';
  let dlg = $state<HTMLDialogElement>();
  let okBtn = $state<HTMLButtonElement>();
  $effect(() => {
    if (!dlg) return;
    if (confirmState.open && !dlg.open) { dlg.showModal(); void tick().then(() => okBtn?.focus()); }
    else if (!confirmState.open && dlg.open) dlg.close();
  });
</script>

<dialog bind:this={dlg} class="confirm" aria-labelledby="confirm-title" onclose={() => confirmState.open && answer(false)}>
  {#if confirmState.req}
    <div class="body">
      <h2 id="confirm-title">{confirmState.req.title}</h2>
      {#if confirmState.req.body}<p class="muted">{confirmState.req.body}</p>{/if}
    </div>
    <div class="actions">
      <button class="btn btn-ghost" onclick={() => answer(false)}>Cancel</button>
      <button class="btn {confirmState.req.danger ? 'btn-danger' : 'btn-primary'}" onclick={() => answer(true)} bind:this={okBtn}>
        {confirmState.req.confirmLabel ?? 'Confirm'}
      </button>
    </div>
  {/if}
</dialog>

<style>
  .confirm {
    border: 1px solid var(--line-strong); border-radius: var(--r-lg); padding: 0; width: min(420px, calc(100vw - 32px));
    background: var(--surface); color: var(--text); box-shadow: var(--shadow-2);
  }
  .confirm[open] { animation: pop 0.3s var(--ease); }
  .confirm::backdrop { background: var(--scrim); backdrop-filter: blur(3px); }
  .body { padding: 22px 22px 8px; display: grid; gap: 8px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px 18px; }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
</style>
