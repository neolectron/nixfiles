"""Exercise exported user-unit isolation policy with synthetic private state only.

Run manually on the target host: the Nix builder has no user systemd manager.
No gateway/tunnel process, production configuration, secret or network is used.
"""
import json
import pathlib
import shlex
import subprocess
import sys
import tempfile
import uuid

root = pathlib.Path(sys.argv[1])


def service_directives(name):
    section = None
    values = {}
    for line in (root / f"{name}.service").read_text().splitlines():
        if line.startswith("["):
            section = line[1:-1]
        elif section == "Service" and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key, []).append(value)
    return values


# Copy every security-relevant Service directive, but never runtime credentials,
# the production working directory, the real ExecStart or service dependencies.
# ReadWritePaths is redirected to the synthetic directory when testing old units.
ignored = {
    "Type", "Restart", "RestartSec", "TimeoutStopSec", "WorkingDirectory",
    "ExecStart", "Environment", "EnvironmentFile",
}
node = shlex.split(service_directives("dsh-mcp-gateway")["ExecStart"][0])[0]
probe = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const directory = process.argv[1];
const uid = process.getuid();
const ancestors = [];
for (let p = directory; ; p = path.dirname(p)) {
  const info = fs.lstatSync(p);
  ancestors.push({path: p, uid: info.uid, mode: info.mode & 0o777});
  if (p === path.dirname(p)) break;
}
console.log(JSON.stringify({uid, ancestors}));
for (const ancestor of ancestors) {
  assert(ancestor.uid === 0 || ancestor.uid === uid,
    'Untrusted private-file ancestor ' + ancestor.path + ': UID ' + ancestor.uid);
}
const databasePath = path.join(directory, 'admission.sqlite');
const database = new DatabaseSync(databasePath);
database.exec('CREATE TABLE probe (value INTEGER); INSERT INTO probe VALUES (42)');
assert.equal(database.prepare('SELECT value FROM probe').get().value, 42);
database.close();
assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);
const fd = fs.openSync(directory, 'r');
fs.fsyncSync(fd);
fs.closeSync(fd);
console.log(JSON.stringify({ownership: 'trusted', sqlite: 'write-read-ok', directoryFsync: 'ok'}));
"""

failed = False
for name in ["dsh-mcp-gateway", "dsh-mcp-tunnel"]:
    with tempfile.TemporaryDirectory(prefix="dsh-mcp-unit-fixture-", dir=pathlib.Path.home() / ".cache") as temporary:
        unit = f"dsh-mcp-policy-fixture-{uuid.uuid4().hex[:12]}"
        command = ["systemd-run", "--user", "--quiet", "--wait", "--pipe", "--collect", f"--unit={unit}", "--property=RuntimeMaxSec=20s"]
        for key, values in service_directives(name).items():
            if key in ignored:
                continue
            for value in values:
                command.extend(["--property", f"{key}={temporary if key == 'ReadWritePaths' else value}"])
        command.extend([node, "--no-warnings", "-e", probe, temporary])
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        print(json.dumps({"policy": name, "exit": result.returncode}))
        print(result.stdout, end="")
        if result.returncode:
            failed = True
            print(result.stderr, end="", file=sys.stderr)

raise SystemExit(1 if failed else 0)
