<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { open, onclose, label, width = 620, children }: {
    open: boolean;
    onclose: () => void;
    label: string;
    width?: number;
    children: Snippet;
  } = $props();

  let dlg = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      // Land focus on the sheet itself (not the close button) so no focus ring
      // flashes on open; Tab still reaches the close button first.
      dlg.focus({ preventScroll: true });
    } else if (!open && dlg.open) dlg.close();
  });

  function onBackdrop(e: MouseEvent) {
    if (e.target === dlg) onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dlg}
  class="sheet"
  tabindex="-1"
  style:--w="{width}px"
  aria-label={label}
  onclose={() => open && onclose()}
  onclick={onBackdrop}
>
  {#if open}
    <div class="inner">
      <button class="icon-btn close" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
      {@render children()}
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    margin: 0 0 0 auto; padding: 0; border: 0; height: 100dvh; max-height: 100dvh;
    width: min(var(--w), 100vw); max-width: 100vw;
    background: var(--bg-raised); color: var(--text);
    border-left: 1px solid var(--line-strong); box-shadow: var(--shadow-2);
    overflow: hidden;
  }
  .sheet[open] { animation: slide 0.34s var(--ease); display: block; }
  .sheet:focus-visible { box-shadow: var(--shadow-2); }
  .sheet::backdrop { background: var(--scrim); backdrop-filter: blur(3px); animation: fade 0.25s ease; }
  .inner { position: relative; height: 100%; overflow-y: auto; overscroll-behavior: contain; }
  .close { position: absolute; top: 12px; right: 12px; z-index: 5; background: oklch(0 0 0 / 0.38); color: #fff; backdrop-filter: blur(8px); }
  .close:hover { background: oklch(0 0 0 / 0.55); color: #fff; }
  @keyframes slide { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  @media (max-width: 720px) {
    .sheet { margin: auto 0 0; width: 100vw; height: 94dvh; max-height: 94dvh; border-left: 0; border-top: 1px solid var(--line-strong); border-radius: 22px 22px 0 0; }
    .sheet[open] { animation: rise-up 0.36s var(--ease); }
    @keyframes rise-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
  }
</style>
