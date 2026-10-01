<script lang="ts">
  import type { ShowState } from '../lib/types';
  import Icon from './Icon.svelte';

  let { state, detail = '', compact = false }: { state: ShowState; detail?: string; compact?: boolean } = $props();

  const MAP: Record<ShowState, { label: string; kind: string; icon: string }> = {
    pending: { label: 'Pending', kind: '', icon: 'clock' },
    downloaded: { label: 'Just added', kind: 'ok', icon: 'download' },
    up_to_date: { label: 'Up to date', kind: 'ok', icon: 'check' },
    waiting_release: { label: 'Waiting for release', kind: 'info', icon: 'clock' },
    not_found: { label: 'Not found', kind: 'bad', icon: 'search' },
    backoff: { label: 'Retrying later', kind: 'warn', icon: 'refresh' },
    search_error: { label: 'Search unavailable', kind: 'warn', icon: 'alert' },
    error: { label: 'Error', kind: 'bad', icon: 'alert' },
  };
  const m = $derived(MAP[state] ?? MAP.pending);
</script>

<span class="chip {m.kind}" title={detail || m.label}>
  <Icon name={m.icon} size={13} stroke={2.1} />
  {#if !compact}{m.label}{/if}
</span>
