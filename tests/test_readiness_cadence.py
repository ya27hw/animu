"""Regression test for readiness staleness threshold floor defect.

Verifies that when the configured scheduler cycle interval is shorter than
MIN_CYCLE_GAP_SECONDS (e.g. interval=1m vs 300s floor), the reconciled staleness
threshold derives from the effective worst-case cycle gap rather than the bare
configured interval.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from animu import readiness
from animu.scheduler import MIN_CYCLE_GAP_SECONDS, Scheduler


class TestReadinessCadenceFloor:
    @pytest.fixture(autouse=True)
    def reset_readiness(self):
        readiness.reset()
        yield
        readiness.reset()

    def _setup_healthy_service(self):
        readiness.mark_database(authenticated=True, offline_safe_mode=False)
        readiness.mark_scheduler_initialized()
        readiness.mark_scheduler_running(True)

    def test_reconciled_threshold_floors_at_min_cycle_gap(self):
        """When configured interval is shorter than MIN_CYCLE_GAP_SECONDS, the
        reconciled threshold must be derived from MIN_CYCLE_GAP_SECONDS so a
        heartbeat aged just under MIN_CYCLE_GAP_SECONDS is fresh (HTTP 200/ready),
        and a heartbeat aged well beyond that gap is stale (HTTP 503/not ready).
        """
        self._setup_healthy_service()

        # Configured interval of 60 seconds (1 minute), as in profile.json interval: 1
        short_interval = 60.0
        assert short_interval < MIN_CYCLE_GAP_SECONDS

        threshold = readiness.reconcile_threshold(short_interval)

        # Threshold must be large enough to accommodate the minimum cycle gap
        assert threshold >= MIN_CYCLE_GAP_SECONDS

        t0 = datetime(2026, 10, 2, 12, 0, 0, tzinfo=timezone.utc)
        readiness.mark_cycle_started(at=t0)
        readiness.mark_cycle_completed(success=True, at=t0)

        # Heartbeat aged just under MIN_CYCLE_GAP_SECONDS (290s vs 300s floor)
        just_under_gap = t0 + timedelta(seconds=MIN_CYCLE_GAP_SECONDS - 10)
        snap_fresh = readiness.health_snapshot(now=just_under_gap)
        assert snap_fresh["ok"] is True
        assert snap_fresh["ready"] is True

        # Heartbeat aged well beyond that gap (past the staleness threshold)
        well_beyond_gap = t0 + timedelta(seconds=threshold + 60)
        snap_stale = readiness.health_snapshot(now=well_beyond_gap)
        assert snap_stale["ok"] is False
        assert snap_stale["ready"] is False

    def test_scheduler_reconciliation_with_short_interval(self):
        """Scheduler reconciling from a short cycle interval preserves readiness
        during legitimate sleep between cycles."""
        self._setup_healthy_service()

        s = Scheduler()
        with patch.object(s, "get_cycle_interval_seconds", return_value=60):
            interval = s.get_cycle_interval_seconds()
            assert interval < MIN_CYCLE_GAP_SECONDS
            threshold = readiness.reconcile_threshold(interval)

        assert threshold >= MIN_CYCLE_GAP_SECONDS

        t0 = datetime(2026, 10, 2, 12, 0, 0, tzinfo=timezone.utc)
        readiness.mark_cycle_started(at=t0)
        readiness.mark_cycle_completed(success=True, at=t0)

        # Still fresh while scheduler sleeps for MIN_CYCLE_GAP_SECONDS
        during_sleep = t0 + timedelta(seconds=MIN_CYCLE_GAP_SECONDS - 15)
        snap_sleep = readiness.health_snapshot(now=during_sleep)
        assert snap_sleep["ready"] is True

        # Stale if wedged well past the threshold
        wedged = t0 + timedelta(seconds=threshold + 120)
        snap_wedged = readiness.health_snapshot(now=wedged)
        assert snap_wedged["ready"] is False
