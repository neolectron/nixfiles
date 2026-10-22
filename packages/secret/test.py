"""Offline integration tests: isolated HOME, synthetic vault, no real bw execution."""
import base64
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

BINARY, WRAPPER = map(os.path.abspath, sys.argv[1:3])
del sys.argv[1:3]


class SecretTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="secret-linux-test-")
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.project = self.home / "project"
        self.project.mkdir()
        self.configdir = self.home / ".config/secret"
        self.configdir.mkdir(parents=True)
        self.bin = self.home / "bin"
        self.bin.mkdir()
        self.log = self.home / "bw-log.jsonl"
        self.vault = self.home / "fake-vault.json"
        self.vault.write_text(json.dumps([
            {"id": "fixture-id", "name": "fixture-item", "login": {"password": "synthetic-value"}, "fields": []}
        ]))
        fake_bw = self.bin / "bw"
        fake_bw.write_text("#!" + sys.executable + "\n" + r'''
import base64, json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps({"args": args, "session": os.getenv("BW_SESSION", "")}) + "\n")
vault_path = Path(os.environ["FAKE_VAULT"])
items = json.loads(vault_path.read_text())
if args == ["status"]:
    print(json.dumps({"status": os.getenv("FAKE_STATUS", "unlocked")}))
elif args == ["unlock", "--raw"]:
    if os.getenv("BW_SESSION"):
        sys.exit(9)
    print("synthetic-session")
elif args == ["lock"]:
    pass
elif args[:2] == ["list", "items"]:
    if os.getenv("FAKE_LARGE"):
        # Fill both pipes: regress wait-before-read and sequential-drain deadlocks.
        sys.stderr.write("x" * 262144)
        sys.stderr.flush()
        items.append({"id": "padding", "name": "padding", "notes": "x" * 262144})
    print(json.dumps(items))
elif args[:2] in (["create", "item"], ["edit", "item"]):
    payload = json.loads(base64.b64decode(sys.stdin.buffer.read()))
    payload.setdefault("id", "created-id")
    items = [item for item in items if item["id"] != payload["id"]] + [payload]
    vault_path.write_text(json.dumps(items))
    print(json.dumps(payload))
elif args[:2] == ["delete", "item"]:
    vault_path.write_text(json.dumps([item for item in items if item["id"] != args[2]]))
else:
    print("unexpected fake bw command", file=sys.stderr)
    sys.exit(98)
''')
        fake_bw.chmod(0o755)
        # Deliberately do not inherit BW_SESSION, SECRET_*, real HOME or vault
        # config. The only bw reachable here is our synthetic executable.
        self.env = {
            "HOME": str(self.home),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "FAKE_LOG": str(self.log),
            "FAKE_VAULT": str(self.vault),
            "SECRET_DAEMON": "0",
            "SECRET_NO_PROMPT": "1",
            "SECRET_NO_BIOMETRICS": "1",
        }
        self.write_config(self.configdir / "config.json", {"global-key": {"item": "fixture-item", "env": "GLOBAL_KEY"}})
        self.write_config(self.project / ".secret.json", {"project-key": {"item": "fixture-item", "env": "PROJECT_KEY"}})
        self.write_config(self.project / ".secret.local.json", {"local-key": {"item": "fixture-item", "env": "LOCAL_KEY"}})

    def write_config(self, path, aliases):
        path.write_text(json.dumps({"secrets": aliases}))

    def run_secret(self, *args, wrapper=False, status=0, data=None, env=None):
        result = subprocess.run(
            [WRAPPER if wrapper else BINARY, *args], cwd=self.project,
            env=self.env | (env or {}), input=data, capture_output=True,
            text=True, timeout=15,
        )
        self.assertEqual(result.returncode, status, result.stderr)
        return result

    def events(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_catalog_contract_is_offline_and_value_free(self):
        rows = json.loads(self.run_secret("print", "--all", "--json", wrapper=True).stdout)
        self.assertEqual({row["scope"] for row in rows}, {"global", "project", "local"})
        self.assertTrue(all({"alias", "scope", "env", "item", "field", "envKey"} <= row.keys() for row in rows))
        self.assertTrue(all("value" not in row for row in rows))
        global_rows = json.loads(self.run_secret("print", "global", "--json", wrapper=True).stdout)
        self.assertEqual([row["alias"] for row in global_rows], ["global-key"])
        self.run_secret("lint", "--json")
        self.assertEqual(self.events(), [])

    def test_large_subprocess_output_does_not_deadlock(self):
        result = self.run_secret("get", "project-key", env={"FAKE_LARGE": "1"})
        self.assertEqual(result.stdout.strip(), "synthetic-value")
        self.assertNotIn("synthetic-value", result.stderr)

    def test_stored_session_wrapper_and_unlock(self):
        session = self.configdir / "session"
        session.write_text("synthetic-session\n")
        session.chmod(0o600)
        self.run_secret("get", "project-key", wrapper=True)
        self.assertTrue(all(event["session"] == "synthetic-session" for event in self.events()))
        result = self.run_secret("unlock", "--store", wrapper=True, env={"BW_SESSION": "stale-session"})
        self.assertEqual(result.stdout, "")
        self.assertEqual(session.read_text().strip(), "synthetic-session")
        self.assertEqual(stat.S_IMODE(session.stat().st_mode), 0o600)
        self.assertTrue(any(event["args"] == ["unlock", "--raw"] and not event["session"] for event in self.events()))
        self.assertFalse((self.configdir / "biometric-session").exists())
        self.run_secret("lock", wrapper=True)
        self.assertFalse(session.exists())
        self.assertFalse(any(event["args"][0] == "serve" for event in self.events()))

    def test_wrapper_rejects_insecure_session(self):
        session = self.configdir / "session"
        session.write_text("synthetic-session")
        session.chmod(0o644)
        result = self.run_secret("status", wrapper=True, status=1)
        self.assertNotIn("synthetic-session", result.stdout + result.stderr)
        self.assertEqual(self.events(), [])

    def test_set_and_rename_contract(self):
        result = self.run_secret("set", "new-key", "--global", "--name", "new-item", data="synthetic-new-value\n")
        self.assertNotIn("synthetic-new-value", result.stdout + result.stderr)
        self.assertEqual(self.run_secret("get", "new-key").stdout.strip(), "synthetic-new-value")
        self.run_secret("mv", "new-key", "renamed-key")
        config = json.loads((self.configdir / "config.json").read_text())
        self.assertIn("renamed-key", config["secrets"])
        self.assertNotIn("new-key", config["secrets"])
        self.assertFalse(any("synthetic-new-value" in " ".join(event["args"]) for event in self.events()))

    def test_linux_rejects_keychain_and_biometric_helper(self):
        self.run_secret("unlock", "--helper", status=1)
        self.assertFalse((self.configdir / "biometric-session").exists())
        (self.configdir / "config.json").write_text('{"backend":"keychain","secrets":{}}')
        self.run_secret("status", status=1)

    def test_write_failure_is_not_reported_as_success(self):
        # Directories cannot be atomically replaced by a JSON alias file.
        destination = self.project / "blocked.json"
        destination.mkdir()
        result = self.run_secret("env", "--output", str(destination), status=1)
        self.assertIn("write", result.stderr.lower())
        self.assertTrue(destination.is_dir())


unittest.main()
