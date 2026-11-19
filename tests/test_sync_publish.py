"""scripts/sync_publish.sh against a stub 'VM' that runs commands locally under a temp root (fabricated data)."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUB = """#!/usr/bin/env bash
# fake VM: 'sudo' is dropped, 'install -o -g' ownership flags are ignored, -m is applied,
# remote paths live under $FAKE_ROOT. FAIL_INSTALL_TO=<remote path> makes that install fail.
[ "$1" = sudo ] && shift
cmd="$1"; shift
case "$cmd" in
  cat) cat "$FAKE_ROOT$1" ;;
  tee) [ -e "$FAKE_ROOT$1" ] && python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$FAKE_ROOT$1" >> "$FAKE_ROOT/tee-modes.log"
       tee "$FAKE_ROOT$1" ;;
  rm) shift; rm -f "$FAKE_ROOT$1" ;;
  test) [ -e "$FAKE_ROOT$2" ] ;;
  true) ;;
  install) mode=644; while [ $# -gt 2 ]; do [ "$1" = -m ] && mode="$2"; shift; done
           src="$1"; dst="$2"
           [ "$dst" = "${FAIL_INSTALL_TO:-}" ] && exit 1
           if [ "$src" = /dev/null ]; then : > "$FAKE_ROOT$dst"; else cp "$FAKE_ROOT$src" "$FAKE_ROOT$dst"; fi
           chmod "$mode" "$FAKE_ROOT$dst" ;;
esac
"""


class SyncPublishTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        (self.tmp / "repo/scripts").mkdir(parents=True)
        (self.tmp / "repo/.local").mkdir()
        shutil.copy(ROOT / "scripts/sync_publish.sh", self.tmp / "repo/scripts")
        (self.tmp / "repo/.local/public.local.toml").write_text('a = "new"\n')
        (self.tmp / "repo/.local/redact_terms.local.json").write_text('["x"]\n')
        pub = self.tmp / "vm/opt/glassbox/publish"
        pub.mkdir(parents=True)
        (pub / "public.toml").write_text('a = "old"\n')
        (pub / "terms.json").write_text('["x"]\n')
        stub = self.tmp / "stub.sh"
        stub.write_text(STUB)
        stub.chmod(0o755)
        self.env = {**os.environ, "GLASSBOX_VM_EXEC": str(stub), "FAKE_ROOT": str(self.tmp / "vm")}

    def run_sync(self, *args, env=None):
        return subprocess.run(["bash", str(self.tmp / "repo/scripts/sync_publish.sh"), *args],
                              env=env or self.env, capture_output=True, text=True)

    def test_unset_target_prints_usage(self):
        env = {k: v for k, v in self.env.items() if k != "GLASSBOX_VM_EXEC"}
        r = self.run_sync(env=env)
        self.assertEqual(r.returncode, 2)
        self.assertIn("usage", r.stderr)

    def test_dry_run_reports_without_contents_or_changes(self):
        r = self.run_sync()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("public.toml: differs (2 lines)", r.stdout)
        self.assertIn("terms.json: same", r.stdout)
        self.assertNotIn("old", r.stdout)
        self.assertNotIn("new", r.stdout)
        self.assertEqual((self.tmp / "vm/opt/glassbox/publish/public.toml").read_text(), 'a = "old"\n')

    def test_show_diff_prints_diff(self):
        self.assertIn('+a = "new"', self.run_sync("--show-diff").stdout)

    def test_apply_copies_only_the_differing_file_and_leaves_no_temp(self):
        r = self.run_sync("--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        pub = self.tmp / "vm/opt/glassbox/publish"
        self.assertEqual((pub / "public.toml").read_text(), 'a = "new"\n')
        self.assertEqual(sorted(p.name for p in pub.iterdir()), ["public.toml", "terms.json"])

    def test_temp_file_is_private_before_contents_are_written(self):
        self.assertEqual(self.run_sync("--apply").returncode, 0)
        self.assertEqual((self.tmp / "vm/tee-modes.log").read_text().split(), ["0o640"])
        self.assertEqual(oct((self.tmp / "vm/opt/glassbox/publish/public.toml").stat().st_mode & 0o777), "0o640")

    def test_missing_remote_file_is_reported_then_created(self):
        pub = self.tmp / "vm/opt/glassbox/publish"
        (pub / "terms.json").unlink()
        r = self.run_sync()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("terms.json: missing on the VM", r.stdout)
        self.assertEqual(self.run_sync("--apply").returncode, 0)
        self.assertEqual((pub / "terms.json").read_text(), '["x"]\n')

    def test_failed_install_removes_temp_and_names_what_was_updated(self):
        pub = self.tmp / "vm/opt/glassbox/publish"
        (pub / "terms.json").write_text('["old"]\n')
        r = self.run_sync("--apply", env={**self.env, "FAIL_INSTALL_TO": "/opt/glassbox/publish/terms.json"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("already updated: /opt/glassbox/publish/public.toml", r.stderr)
        self.assertEqual(sorted(p.name for p in pub.iterdir()), ["public.toml", "terms.json"])

    def test_unreachable_vm_is_an_error_not_missing_files(self):
        r = self.run_sync(env={**self.env, "GLASSBOX_VM_EXEC": "false"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("cannot reach the VM", r.stderr)
        self.assertNotIn("missing", r.stdout)

    def test_apply_refuses_invalid_local_config(self):
        (self.tmp / "repo/.local/redact_terms.local.json").write_text("{not json")
        self.assertNotEqual(self.run_sync("--apply").returncode, 0)
        self.assertEqual((self.tmp / "vm/opt/glassbox/publish/public.toml").read_text(), 'a = "old"\n')


if __name__ == "__main__":
    unittest.main()
