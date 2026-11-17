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
        self.assertEqual(len(starts), 3)                    # /opt/glassbox, serve.json, ts_authkey
        for i in starts:
            blk = "\n".join(lines[i:i + 7])
            self.assertIn("read_only: true", blk, blk)
            self.assertIn("create_host_path: false", blk, blk)
        # the Docker socket is the one short-syntax bind and must be :ro
        self.assertIn("/var/run/docker.sock:/var/run/docker.sock:ro", COMPOSE)

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
