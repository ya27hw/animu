import type { Status } from './types';
import { countdown } from './format';

export interface SchedulerView {
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  title: string;
  sub: string;
  /** 0..1 progress through the current wait (or null while a cycle runs / unknown). */
  progress: number | null;
  running: boolean;
  remainingMs: number | null;
}

export function schedulerView(s: Status | null, now: number): SchedulerView {
  if (!s) return { tone: 'idle', title: 'Connecting…', sub: '', progress: null, running: false, remainingMs: null };
  const h = s.scheduler;
  if (!h.scheduler_running) {
    return { tone: 'bad', title: 'Scheduler stopped', sub: 'The background loop is not running.', progress: null, running: false, remainingMs: null };
  }
  if (h.cycle_running) {
    const since = h.cycle_running_since ? Date.parse(h.cycle_running_since) : now;
    return { tone: 'ok', title: 'Cycle running', sub: `for ${countdown(now - since)}`, progress: null, running: true, remainingMs: null };
  }
  const next = h.next_run_at ? Date.parse(h.next_run_at) : null;
  const tone = h.last_error_type ? 'bad' : h.degraded ? 'warn' : 'ok';
  if (next == null) return { tone, title: 'Waiting', sub: '', progress: null, running: false, remainingMs: null };
  const remaining = next - now;
  const startedAt = h.last_cycle_started_at ? Date.parse(h.last_cycle_started_at) : next - s.intervalMinutes * 60_000;
  const span = Math.max(1, next - startedAt);
  const progress = Math.min(1, Math.max(0, 1 - remaining / span));
  return {
    tone,
    title: remaining > 0 ? `Next cycle in ${countdown(remaining)}` : 'Starting…',
    sub: h.last_error_type ? `Last cycle failed (${h.last_error_type})` : h.degraded ? 'Last cycle had errors' : 'Everything is on schedule',
    progress,
    running: false,
    remainingMs: remaining,
  };
}
