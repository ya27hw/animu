# Animu Production Deployment & Auto-Update Guide (CT102)

This document describes the production deployment and automated GitHub update pipeline for Animu on CT102 (`/root/animu`).

---

## 1. Architecture Overview

- **Host**: CT102 container (`10.0.0.2`), working directory `/root/animu`.
- **Branch**: `python-rewrite` tracking `origin/python-rewrite` (`git@github.com:ya27hw/animu.git`).
- **Main Service**: `animu.service` running `main.py --schedule` under Python 3 venv.
- **Auto-Updater**: `animu-update.service` triggered by `animu-update.timer` (every 15 minutes).
- **Health Check**: Native `/api/health` HTTP endpoint (port 3210) validating runtime readiness.

---

## 2. Auto-Update Workflow & Safety Guarantees

The update runner (`/root/animu/scripts/animu-update.sh`) executes on a 15-minute timer with the following safety gates:

1. **Flock Locking**: Acquires an exclusive non-blocking lock (`/run/lock/animu-update.lock` or `/tmp/animu-update.lock`) to prevent overlapping update runs.
2. **Dirty Tree Detection**: Verifies that the deployment directory has no uncommitted tracked modifications (`git diff` and `git diff --cached`) or untracked files (`git status --porcelain`). If uncommitted modifications or untracked files are detected, update is refused.
3. **Target Polling**: Fetches the exact target branch `origin/python-rewrite` quietly without altering working state.
4. **Quiet Exit on Unchanged**: If `HEAD` matches `origin/python-rewrite`, exits code 0 without restarting the service.
5. **Fast-Forward Only Enforcement**: Verifies `origin/python-rewrite` is an ancestor of `HEAD` using `git merge-base --is-ancestor`. Non-fast-forward updates (divergent histories or rebased trees) are rejected.
6. **Rollback Target Recording**: Pre-update commit hash (`PREV_COMMIT`) is recorded prior to touching the checkout.
7. **Fast-Forward Merge**: Applies `git merge --ff-only origin/python-rewrite`.
8. **Dependency Update**: If `requirements.txt` changed between commits, runs `./venv/bin/pip install -r requirements.txt`.
9. **Service Restart & Health Verification**: Restarts `animu.service` and polls `http://127.0.0.1:3210/api/health` for up to 30 seconds to confirm the service is active and reporting healthy readiness.
10. **Automated Rollback**: If restart or `/api/health` verification fails, the script automatically resets the git checkout back to `PREV_COMMIT` (`git reset --hard $PREV_COMMIT`), reinstalls dependencies if needed, restarts `animu.service`, and verifies recovery.
11. **Secret Isolation**: Operates without access to credentials, webhooks, or `profile.json`. Logs only sanitized decisions and commit hashes to journald.

---

## 3. Installation Steps on CT102

Run the following commands on CT102 to install and activate the update timer:

```bash
# 1. Ensure scripts and units are executable and placed in systemd
chmod +x /root/animu/scripts/animu-update.sh
cp /root/animu/systemd/animu-update.service /etc/systemd/system/animu-update.service
cp /root/animu/systemd/animu-update.timer /etc/systemd/system/animu-update.timer

# 2. Reload systemd daemon
systemctl daemon-reload

# 3. Enable and start the timer
systemctl enable --now animu-update.timer

# 4. Verify timer is active and scheduled
systemctl list-timers animu-update.timer
```

---

## 4. Verification & Operational Commands

### Check Timer Status
```bash
systemctl status animu-update.timer
```

### Run Manual Update Test (Dry Run or Direct Execution)
```bash
/root/animu/scripts/animu-update.sh
```

### View Update Logs in Journald
```bash
journalctl -u animu-update.service -n 50 --no-pager
```

### Inspect Animu Service Health
```bash
curl -s http://127.0.0.1:3210/api/health | jq .
```

---

## 5. Failure Recovery & Manual Rollback

If a bad commit causes an issue and needs manual intervention:

```bash
# 1. Roll back to known-good commit
cd /root/animu
git reset --hard <KNOWN_GOOD_COMMIT_SHA>

# 2. Re-install Python requirements
./venv/bin/pip install -r requirements.txt

# 3. Restart Animu
systemctl restart animu.service

# 4. Verify health
curl -s http://127.0.0.1:3210/api/health
```
