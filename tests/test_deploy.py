"""deploy/ and the Gitea workflow: static guarantees that do not need Docker.

Text checks on purpose (no YAML parser in the standard library); the files are written so that
these patterns are stable.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = (ROOT / "deploy" / "compose.yaml").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".gitea" / "workflows" / "glassbox.yml").read_text(encoding="utf-8")
SERVE = (ROOT / "deploy" / "serve.json").read_text(encoding="utf-8")
CHECKED = {
    "compose.yaml": COMPOSE, "glassbox.yml": WORKFLOW, "serve.json": SERVE,
    "hub.example.toml": (ROOT / "deploy" / "hub.example.toml").read_text(encoding="utf-8"),
    "README.md": (ROOT / "deploy" / "README.md").read_text(encoding="utf-8"),
    "deploy-hub.md": (ROOT / "docs" / "runbooks" / "deploy-hub.md").read_text(encoding="utf-8"),
}
IPV4 = re.compile(r"(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])")
LOOPBACK_OK = {"127.0.0.1", "0.0.0.0"}


def code_lines(text):
    return [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]


class DeployTest(unittest.TestCase):
    def test_compose_publishes_no_ports(self):
        for ln in code_lines(COMPOSE):
            self.assertNotRegex(ln, r"^\s*ports\s*:", ln)
        self.assertNotRegex(COMPOSE.replace("\n", " "), r"\bpublished\s*:")

    def test_no_ipv4_literal_in_deploy_files(self):
        for name, text in CHECKED.items():
            for m in IPV4.finditer("\n".join(code_lines(text))):
                self.assertIn(m.group(0), LOOPBACK_OK, f"{name}: {m.group(0)}")

    def test_serve_config_has_no_funnel(self):
        self.assertNotIn("AllowFunnel", SERVE)
        json.loads(SERVE)
        for name, text in CHECKED.items():
            if name in ("compose.yaml", "serve.json"):
                self.assertNotRegex("\n".join(code_lines(text)), r"AllowFunnel\"?\s*:\s*true", name)

    def test_every_bind_mount_is_read_only_and_never_created(self):
        lines = COMPOSE.splitlines()
        starts = [i for i, ln in enumerate(lines) if ln.strip() == "- type: bind"]
        self.assertEqual(len(starts), 4)                    # hub.toml, secrets/, serve.json, ts_authkey
        for i in starts:
            blk = "\n".join(lines[i:i + 7])
            self.assertIn("read_only: true", blk, blk)
            self.assertIn("create_host_path: false", blk, blk)
        # the Docker socket is the one short-syntax bind and must be :ro
        self.assertIn("/var/run/docker.sock:/var/run/docker.sock:ro", COMPOSE)

    def test_hub_mounts_only_its_config_and_secrets(self):
        hub = "\n".join(code_lines(COMPOSE.split("\n  tailscale:")[0]))
        self.assertNotRegex(hub, r'target: /run/glassbox\s*\n')
        self.assertIn("target: /run/glassbox/hub.toml", hub)
        self.assertIn("target: /run/glassbox/secrets", hub)
        self.assertNotIn("ts_authkey", hub)

    def test_container_user_has_pinned_uid_and_gid(self):
        df = (ROOT / "deploy" / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("groupadd --system --gid 10001 glassbox", df)
        self.assertIn("--uid 10001 --gid 10001", df)
        self.assertIn("USER 10001:10001", df)

    def test_sidecar_uses_auth_key_once(self):
        self.assertIn('TS_AUTH_ONCE: "true"', COMPOSE)

    def test_entrypoint_fails_closed_on_missing_secrets_dir(self):
        ep = (ROOT / "deploy" / "entrypoint.sh").read_text(encoding="utf-8")
        self.assertIn('[ -n "${GLASSBOX_SECRETS_DIR:-}" ]', ep)
        self.assertIn("exit 1", ep)

    def test_entrypoint_exits_1_on_empty_secrets_dir(self):
        import os, subprocess, tempfile
        ep = str(ROOT / "deploy" / "entrypoint.sh")
        with tempfile.TemporaryDirectory() as d:
            env = {**os.environ, "GLASSBOX_SECRETS_DIR": d}
            r = subprocess.run(["sh", ep, "check-secrets"], env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("no readable non-empty secret file", r.stderr)
            Path(d, "github_token").write_text("x", encoding="utf-8")
            r = subprocess.run(["sh", ep, "check-secrets"], env=env, capture_output=True, text=True)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, "GITHUB_TOKEN: set"))

    def test_preflight_checks_readability_and_traversal(self):
        self.assertIn("[ -r", WORKFLOW)
        self.assertIn("/s/secrets", WORKFLOW)
        self.assertIn("--user 10001:10001", WORKFLOW)

    def test_workflow_checks_serve_and_funnel_status(self):
        self.assertIn("tailscale serve status", WORKFLOW)
        self.assertIn("tailscale funnel status", WORKFLOW)
        self.assertIn("127.0.0.1:8787", WORKFLOW)

    def test_docker_gid_comes_from_the_host_daemon(self):
        self.assertIn('docker run --rm -v /var/run/docker.sock:/s:ro "$PREFLIGHT_IMAGE" stat -c %g /s', WORKFLOW)

    def test_private_files_come_from_the_vm_directory(self):
        self.assertIn('${GLASSBOX_DIR:-/opt/glassbox}', COMPOSE)
        self.assertNotIn("./secrets", COMPOSE)
        self.assertNotIn("\nsecrets:", COMPOSE)            # no compose-level secrets from the checkout

    def test_sidecar_advertises_no_routes_or_exit_node(self):
        for ln in code_lines(COMPOSE):
            self.assertNotRegex(ln, r"advertise-routes|advertise-exit-node|exit-node|accept-routes", ln)

    def test_image_and_tag_are_required_variables(self):
        self.assertIn("${GLASSBOX_IMAGE:?", COMPOSE)
        self.assertIn("${IMAGE_TAG:?", COMPOSE)

    def test_workflow_secrets_and_variables(self):
        self.assertEqual(set(re.findall(r"secrets\.(\w+)", WORKFLOW)), {"REGISTRY_TOKEN"})
        self.assertEqual(set(re.findall(r"vars\.(\w+)", WORKFLOW)), {"REGISTRY", "IMAGE"})

    def test_workflow_tag_input_is_validated_and_goes_through_env(self):
        self.assertIn("INPUT_TAG: ${{ inputs.tag }}", WORKFLOW)
        for ln in WORKFLOW.splitlines():
            if "${{ inputs.tag }}" in ln:
                self.assertTrue(ln.strip().startswith("INPUT_TAG:"), ln)
        self.assertIn("[0-9a-f]{40}", WORKFLOW)

    def test_workflow_triggers_and_gates(self):
        for p in ("deploy/**", "hub/**", "probe/**", "web/**", "schema/**", ".gitea/workflows/glassbox.yml"):
            self.assertIn(f'- "{p}"', WORKFLOW)
        self.assertIn("workflow_dispatch:", WORKFLOW)
        self.assertIn("gitea.ref == 'refs/heads/main'", WORKFLOW)

    def test_preflight_runs_before_build_and_deploy(self):
        pre = WORKFLOW.index("预检 /opt/glassbox")
        self.assertLess(pre, WORKFLOW.index("构建并推送"))
        self.assertLess(pre, WORKFLOW.index("docker compose -f deploy/compose.yaml up"))

    def test_workflow_checks_exposure_after_deploy(self):
        self.assertIn("PortBindings", WORKFLOW)
        self.assertIn("evil.example", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
