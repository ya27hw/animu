import { onMount } from 'svelte';

/** Shared 1 Hz clock. The timer only runs while at least one component uses it. */
export const clock = $state({ now: Date.now() });

let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

export function useClock(): void {
  onMount(() => {
    users++;
    clock.now = Date.now();
    if (users === 1) timer = setInterval(() => (clock.now = Date.now()), 1000);
    return () => {
      users--;
      if (users === 0 && timer) clearInterval(timer);
    };
  });
}
