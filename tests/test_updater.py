import unittest
import tempfile
import os
import subprocess
import shutil


class TestUpdater(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="animu_updater_test_")
        self.remote_dir = os.path.join(self.test_dir, "remote.git")
        self.app_dir = os.path.join(self.test_dir, "app")
        self.lock_file = os.path.join(self.test_dir, "update.lock")

        # 1. Create bare remote repo
        subprocess.run(["git", "init", "--bare", self.remote_dir], check=True, capture_output=True)

        # 2. Init app dir, configure user and remote
        os.makedirs(self.app_dir, exist_ok=True)
        subprocess.run(["git", "init", "-b", "python-rewrite", self.app_dir], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.app_dir, "config", "user.email", "test@animu.local"], check=True)
        subprocess.run(["git", "-C", self.app_dir, "config", "user.name", "Test User"], check=True)
        subprocess.run(["git", "-C", self.app_dir, "remote", "add", "origin", self.remote_dir], check=True)

        # 3. Initial commit in app_dir and push
        with open(os.path.join(self.app_dir, "version.txt"), "w") as f:
            f.write("v1.0.0\n")
        subprocess.run(["git", "-C", self.app_dir, "add", "version.txt"], check=True)
        subprocess.run(["git", "-C", self.app_dir, "commit", "-m", "Initial commit"], check=True, capture_output=True)
        subprocess.run(["git", "-C", self.app_dir, "push", "-u", "origin", "python-rewrite"], check=True, capture_output=True)

        # Path to animu-update.sh
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.script_path = os.path.join(repo_root, "scripts", "animu-update.sh")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _run_updater(self, extra_env=None):
        env = os.environ.copy()
        env["ANIMU_DIR"] = self.app_dir
        env["ANIMU_BRANCH"] = "python-rewrite"
        env["ANIMU_REMOTE"] = "origin"
        env["ANIMU_SERVICE"] = "animu-test.service"
        env["ANIMU_LOCK_FILE"] = self.lock_file
        env["ANIMU_HEALTH_TIMEOUT"] = "2"
        # Mock commands by default
        env["ANIMU_RESTART_CMD"] = "true"
        env["ANIMU_CHECK_ACTIVE_CMD"] = "true"
        # Local file URL / mock health via python command or direct URL
        env["ANIMU_HEALTH_URL"] = "http://127.0.0.1:9999/api/health"

        if extra_env:
            env.update(extra_env)

        return subprocess.run(["bash", self.script_path], env=env, capture_output=True, text=True)

    def test_updater_no_changes_exits_quietly(self):
        """When remote commit matches local HEAD, updater exits 0 without error."""
        res = self._run_updater()
        self.assertEqual(res.returncode, 0)
        self.assertIn("No update needed", res.stdout)

    def test_updater_clean_fast_forward_success(self):
        """When remote has a new fast-forward commit, updater applies it and exits 0."""
        # Make a new commit from another clone and push to remote
        clone_dir = os.path.join(self.test_dir, "clone2")
        subprocess.run(["git", "clone", "-b", "python-rewrite", self.remote_dir, clone_dir], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.email", "test@animu.local"], check=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.name", "Test User"], check=True)

        with open(os.path.join(clone_dir, "version.txt"), "w") as f:
            f.write("v1.1.0\n")
        subprocess.run(["git", "-C", clone_dir, "commit", "-am", "Release v1.1.0"], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "push", "origin", "python-rewrite"], check=True, capture_output=True)

        # Mock health check server returning 200
        import http.server
        import threading
        class HealthHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok": true, "ready": true}')

        server = http.server.HTTPServer(("127.0.0.1", 39281), HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            res = self._run_updater(extra_env={"ANIMU_HEALTH_URL": "http://127.0.0.1:39281/api/health"})
            self.assertEqual(res.returncode, 0)
            self.assertIn("Update succeeded", res.stdout)
            with open(os.path.join(self.app_dir, "version.txt"), "r") as f:
                self.assertEqual(f.read().strip(), "v1.1.0")
        finally:
            server.shutdown()
            server.server_close()

    def test_updater_rejects_dirty_tree(self):
        """When deployment checkout has uncommitted tracked changes, update is refused."""
        with open(os.path.join(self.app_dir, "version.txt"), "w") as f:
            f.write("dirty-modification\n")

        res = self._run_updater()
        self.assertEqual(res.returncode, 1)
        self.assertIn("Refusing to update dirty repository", res.stderr)
        self.assertIn("uncommitted tracked changes", res.stderr)

    def test_updater_rejects_untracked_files(self):
        """When deployment checkout has untracked files, update is refused."""
        with open(os.path.join(self.app_dir, "untracked_file.txt"), "w") as f:
            f.write("untracked-content\n")

        res = self._run_updater()
        self.assertEqual(res.returncode, 1)
        self.assertIn("Refusing to update dirty repository", res.stderr)
        self.assertIn("untracked files", res.stderr)

    def test_default_health_url_is_3210(self):
        """Verify animu-update.sh default health URL uses port 3210."""
        with open(self.script_path, "r") as f:
            content = f.read()
        self.assertIn("http://127.0.0.1:3210/api/health", content)
        self.assertNotIn("3219", content)

    def test_updater_rejects_non_fast_forward(self):
        """When remote branch has diverged, non-fast-forward update is rejected."""
        # Advance local app_dir with a commit
        with open(os.path.join(self.app_dir, "local.txt"), "w") as f:
            f.write("local only\n")
        subprocess.run(["git", "-C", self.app_dir, "add", "local.txt"], check=True)
        subprocess.run(["git", "-C", self.app_dir, "commit", "-m", "Local commit"], check=True, capture_output=True)

        # Advance remote with a different commit
        clone_dir = os.path.join(self.test_dir, "clone2")
        subprocess.run(["git", "clone", "-b", "python-rewrite", self.remote_dir, clone_dir], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.email", "test@animu.local"], check=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.name", "Test User"], check=True)
        with open(os.path.join(clone_dir, "remote.txt"), "w") as f:
            f.write("remote only\n")
        subprocess.run(["git", "-C", clone_dir, "add", "remote.txt"], check=True)
        subprocess.run(["git", "-C", clone_dir, "commit", "-m", "Remote commit"], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "push", "origin", "python-rewrite"], check=True, capture_output=True)

        res = self._run_updater()
        self.assertEqual(res.returncode, 1)
        self.assertIn("Non-fast-forward update rejected", res.stderr)

    def test_updater_health_failure_triggers_rollback(self):
        """When update succeeds in git but post-update health check fails, working tree rolls back to prior commit."""
        pre_commit = subprocess.check_output(["git", "-C", self.app_dir, "rev-parse", "HEAD"]).decode().strip()

        # Push new commit to remote
        clone_dir = os.path.join(self.test_dir, "clone2")
        subprocess.run(["git", "clone", "-b", "python-rewrite", self.remote_dir, clone_dir], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.email", "test@animu.local"], check=True)
        subprocess.run(["git", "-C", clone_dir, "config", "user.name", "Test User"], check=True)
        with open(os.path.join(clone_dir, "broken.txt"), "w") as f:
            f.write("broken\n")
        subprocess.run(["git", "-C", clone_dir, "add", "broken.txt"], check=True)
        subprocess.run(["git", "-C", clone_dir, "commit", "-m", "Broken commit"], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "push", "origin", "python-rewrite"], check=True, capture_output=True)

        # Health endpoint fails (no server listening on port 39282)
        res = self._run_updater(extra_env={
            "ANIMU_HEALTH_URL": "http://127.0.0.1:39282/api/health",
            "ANIMU_HEALTH_TIMEOUT": "2"
        })
        self.assertEqual(res.returncode, 1)
        self.assertIn("Post-update health check failed! Initiating rollback", res.stderr)
        self.assertIn("ROLLBACK: Rolling back working tree", res.stderr)

        # Working tree must be restored to pre_commit
        post_rollback_commit = subprocess.check_output(["git", "-C", self.app_dir, "rev-parse", "HEAD"]).decode().strip()
        self.assertEqual(post_rollback_commit, pre_commit)
        self.assertFalse(os.path.exists(os.path.join(self.app_dir, "broken.txt")))

    def test_updater_lock_contention(self):
        """When another process holds the flock lock, updater exits 0 gracefully."""
        import fcntl
        with open(self.lock_file, "w") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            res = self._run_updater()
            self.assertEqual(res.returncode, 0)
            self.assertIn("Another update process is already active. Skipping", res.stdout)


if __name__ == "__main__":
    unittest.main()
