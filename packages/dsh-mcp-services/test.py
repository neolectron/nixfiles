"""Read-only contract checks for the two generated systemd unit artifacts."""
import pathlib
import sys
import unittest

ROOT = pathlib.Path(sys.argv.pop(1))


def directives(name):
    result = {}
    section = None
    for line in (ROOT / f"{name}.service").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        if line.startswith("["):
            section = line[1:-1]
            continue
        key, value = line.split("=", 1)
        result.setdefault((section, key), []).append(value)
    return result


class ServiceContracts(unittest.TestCase):
    def test_exactly_two_owned_units(self):
        self.assertEqual(
            sorted(p.name for p in ROOT.glob("*.service")),
            ["dsh-mcp-gateway.service", "dsh-mcp-tunnel.service"],
        )

    def test_gateway_uses_official_node_and_private_configuration(self):
        unit = directives("dsh-mcp-gateway")
        command = unit["Service", "ExecStart"][0]
        self.assertIn("/fnm/node-versions/v22.23.3/installation/bin/node ", command)
        self.assertIn("/current/dist/main.js --config ", command)
        self.assertTrue(command.endswith("/private/config.json"))
        self.assertEqual(len(unit["Service", "Environment"]), 1)
        self.assertRegex(unit["Service", "Environment"][0], r"^DSH_HOME=/[^\n]+/\.dsh$")
        self.assertNotIn("DSH_MCP_LOCAL_DSH_URL", str(unit))

    def test_secrets_are_runtime_references_only(self):
        for name, filename in [("gateway", "gateway.env"), ("tunnel", "tunnel.env")]:
            unit = directives(f"dsh-mcp-{name}")
            env_file = unit["Service", "EnvironmentFile"][0]
            self.assertTrue(env_file.endswith(f"/private/{filename}"))
            self.assertIn(env_file, unit["Unit", "ConditionPathExists"])
            self.assertNotIn("Bearer ", str(unit))
            self.assertNotIn("sk-", str(unit))
            self.assertNotIn("tunnel_", str(unit))

    def test_no_restart_dependency_on_dsh_or_discord(self):
        gateway = directives("dsh-mcp-gateway")
        self.assertNotIn(("Unit", "Requires"), gateway)
        self.assertNotIn(("Unit", "BindsTo"), gateway)
        tunnel = directives("dsh-mcp-tunnel")
        self.assertEqual(tunnel["Unit", "Requires"], ["dsh-mcp-gateway.service"])
        self.assertEqual(tunnel["Unit", "BindsTo"], ["dsh-mcp-gateway.service"])
        self.assertEqual(tunnel["Unit", "After"], ["dsh-mcp-gateway.service"])

    def test_tunnel_health_is_loopback_and_profile_remains_private(self):
        command = directives("dsh-mcp-tunnel")["Service", "ExecStart"][0]
        self.assertRegex(command, r"^/nix/store/[^ ]+/bin/tunnel-client run --config /")
        self.assertTrue(command.endswith("/private/tunnel.yaml --health.listen-addr 127.0.0.1:8791"))
        self.assertNotIn("--allow-remote-ui", command)
        self.assertNotIn("--embedded", command)

    def test_private_writes_and_bounded_shutdown(self):
        for name in ["gateway", "tunnel"]:
            unit = directives(f"dsh-mcp-{name}")
            for key, value in {
                "Restart": "on-failure", "RestartSec": "5s", "UMask": "0077",
                "ProtectSystem": "strict", "ProtectHome": "read-only",
                "NoNewPrivileges": "true", "PrivateTmp": "true", "TimeoutStopSec": "30s",
            }.items():
                self.assertEqual(unit["Service", key], [value])
            self.assertEqual(len(unit["Service", "ReadWritePaths"]), 1)
            self.assertTrue(unit["Service", "ReadWritePaths"][0].endswith("/private"))
            self.assertEqual(unit["Install", "WantedBy"], ["default.target"])


unittest.main()
