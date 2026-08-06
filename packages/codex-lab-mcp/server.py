#!/usr/bin/env python3
"""A small stdio MCP server for the persistent frostbit-lab QEMU guest."""

import base64
import json
import os
import pathlib
import socket
import struct
import subprocess
import sys
import time
import zlib


REPO = pathlib.Path(os.environ.get("CODEX_LAB_REPO", os.getcwd())).resolve()
# Keep this in /tmp because the VM's QEMU command line is generated
# declaratively and therefore cannot rely on the desktop session environment.
STATE = pathlib.Path("/tmp/codex-lab-vm")
QMP_SOCKET = STATE / "qmp.sock"
RESULT = STATE / "result"
SCREENSHOT = STATE / "screen.ppm"
PID_FILE = STATE / "qemu.pid"


def log(message):
    print(f"codex-lab-mcp: {message}", file=sys.stderr, flush=True)


def respond(request_id, result=None, error=None):
    payload = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        payload["error"] = {"code": -32000, "message": error}
    else:
        payload["result"] = result
    print(json.dumps(payload), flush=True)


def qmp(command, arguments=None):
    if not QMP_SOCKET.exists():
        raise RuntimeError("the lab VM is not running")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(10)
        conn.connect(str(QMP_SOCKET))
        receive_qmp(conn)  # greeting
        send_qmp(conn, {"execute": "qmp_capabilities"})
        receive_qmp(conn)
        request = {"execute": command}
        if arguments:
            request["arguments"] = arguments
        send_qmp(conn, request)
        while True:
            response = receive_qmp(conn)
            if "return" in response:
                return response["return"]
            if "error" in response:
                raise RuntimeError(response["error"].get("desc", "QMP command failed"))


def send_qmp(conn, payload):
    conn.sendall(json.dumps(payload).encode() + b"\r\n")


def receive_qmp(conn):
    data = b""
    while not data.endswith(b"\n"):
        chunk = conn.recv(4096)
        if not chunk:
            raise RuntimeError("QMP disconnected")
        data += chunk
    return json.loads(data.decode())


def hmp(command):
    return qmp("human-monitor-command", {"command-line": command})


def vm_running():
    try:
        qmp("query-status")
        return True
    except (OSError, RuntimeError):
        return False


def start_vm():
    if vm_running():
        return "already running"
    STATE.mkdir(parents=True, exist_ok=True)
    QMP_SOCKET.unlink(missing_ok=True)
    build = subprocess.run(
        [
            "nix",
            "build",
            f"{REPO}#nixosConfigurations.frostbit-lab.config.system.build.vm",
            "--out-link",
            str(RESULT),
        ],
        cwd=REPO,
        text=True,
        capture_output=True,
    )
    if build.returncode:
        raise RuntimeError(build.stderr.strip() or "failed to build frostbit-lab")
    launcher = RESULT / "bin" / "run-frostbit-lab-vm"
    if not launcher.exists():
        raise RuntimeError(f"VM launcher was not produced: {launcher}")
    env = os.environ | {"CODEX_LAB_REPO": str(REPO)}
    process = subprocess.Popen(
        [str(launcher)], cwd=STATE, env=env, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
    )
    PID_FILE.write_text(str(process.pid))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if vm_running():
            return "started"
        time.sleep(0.25)
    raise RuntimeError("QEMU did not create its QMP socket within 30 seconds")


def ppm_to_png(path):
    data = path.read_bytes()
    if not data.startswith(b"P6"):
        raise RuntimeError("QEMU did not produce a binary PPM screenshot")
    tokens = []
    index = 2
    while len(tokens) < 3:
        while index < len(data) and data[index:index + 1].isspace():
            index += 1
        if data[index:index + 1] == b"#":
            index = data.index(b"\n", index) + 1
            continue
        end = index
        while end < len(data) and not data[end:end + 1].isspace():
            end += 1
        tokens.append(int(data[index:end]))
        index = end
    while index < len(data) and data[index:index + 1].isspace():
        index += 1
    width, height, max_value = tokens
    if max_value != 255:
        raise RuntimeError("unsupported PPM colour depth")
    pixels = data[index:]
    expected = width * height * 3
    if len(pixels) != expected:
        raise RuntimeError("incomplete screenshot")
    rows = b"".join(b"\0" + pixels[row * width * 3:(row + 1) * width * 3] for row in range(height))

    def chunk(kind, contents):
        return struct.pack(">I", len(contents)) + kind + contents + struct.pack(">I", zlib.crc32(kind + contents) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def screenshot():
    STATE.mkdir(parents=True, exist_ok=True)
    SCREENSHOT.unlink(missing_ok=True)
    hmp(f"screendump {SCREENSHOT}")
    deadline = time.monotonic() + 5
    while not SCREENSHOT.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not SCREENSHOT.exists():
        raise RuntimeError("QEMU did not write a screenshot")
    return ppm_to_png(SCREENSHOT)


def send_events(events):
    qmp("input-send-event", {"events": events})


def mouse(x, y, width, height, click=False):
    x_abs = max(0, min(32767, round(x * 32767 / width)))
    y_abs = max(0, min(32767, round(y * 32767 / height)))
    events = [
        {"type": "abs", "data": {"axis": "x", "value": x_abs}},
        {"type": "abs", "data": {"axis": "y", "value": y_abs}},
    ]
    if click:
        events.extend([
            {"type": "btn", "data": {"button": "left", "down": True}},
            {"type": "btn", "data": {"button": "left", "down": False}},
        ])
    send_events(events)


KEYS = {
    " ": "spc", "\n": "ret", "\t": "tab", "-": "minus", "=": "equal",
    "[": "bracket_left", "]": "bracket_right", ";": "semicolon", "'": "apostrophe",
    "`": "grave_accent", ",": "comma", ".": "dot", "/": "slash", "\\": "backslash",
}
SHIFTED = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0", "_": "minus", "+": "equal", "{": "bracket_left", "}": "bracket_right", ":": "semicolon", '"': "apostrophe", "~": "grave_accent", "<": "comma", ">": "dot", "?": "slash", "|": "backslash"}


def key_events(key, shift=False):
    key_data = {"type": "qcode", "data": key}
    events = []
    if shift:
        events.append({"type": "key", "data": {"key": {"type": "qcode", "data": "shift"}, "down": True}})
    events.extend([
        {"type": "key", "data": {"key": key_data, "down": True}},
        {"type": "key", "data": {"key": key_data, "down": False}},
    ])
    if shift:
        events.append({"type": "key", "data": {"key": {"type": "qcode", "data": "shift"}, "down": False}})
    return events


def type_text(text):
    for char in text:
        if char.isalpha():
            send_events(key_events(char.lower(), char.isupper()))
        elif char.isdigit():
            send_events(key_events(char))
        elif char in KEYS:
            send_events(key_events(KEYS[char]))
        elif char in SHIFTED:
            send_events(key_events(SHIFTED[char], True))
        else:
            raise RuntimeError(f"cannot type character: {char!r}")


TOOLS = [
    {"name": "lab_vm_start", "description": "Build and boot the persistent frostbit-lab NixOS QEMU VM.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lab_vm_stop", "description": "Shut down the running lab VM process.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lab_vm_status", "description": "Report whether the lab VM is running.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lab_vm_screenshot", "description": "Capture the lab VM framebuffer as a PNG image.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lab_vm_click", "description": "Click a pixel coordinate in the lab VM framebuffer.", "inputSchema": {"type": "object", "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}, "width": {"type": "integer", "default": 1280}, "height": {"type": "integer", "default": 720}}, "required": ["x", "y"]}},
    {"name": "lab_vm_type", "description": "Type US-layout text into the focused lab VM window.", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    {"name": "lab_vm_key", "description": "Send a QEMU key name, for example ctrl-alt-t, esc, or ret.", "inputSchema": {"type": "object", "properties": {"keys": {"type": "string"}}, "required": ["keys"]}},
    {"name": "lab_vm_reset", "description": "Hard-reset the lab VM.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lab_vm_snapshot", "description": "Save or restore a named QEMU snapshot.", "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["save", "load"]}, "name": {"type": "string"}}, "required": ["action", "name"]}},
]


def call_tool(name, arguments):
    if name == "lab_vm_start":
        return [{"type": "text", "text": start_vm()}]
    if name == "lab_vm_stop":
        qmp("quit")
        return [{"type": "text", "text": "stopped"}]
    if name == "lab_vm_status":
        return [{"type": "text", "text": "running" if vm_running() else "stopped"}]
    if name == "lab_vm_screenshot":
        return [{"type": "image", "data": base64.b64encode(screenshot()).decode(), "mimeType": "image/png"}]
    if name == "lab_vm_click":
        mouse(arguments["x"], arguments["y"], arguments.get("width", 1280), arguments.get("height", 720), True)
        return [{"type": "text", "text": "clicked"}]
    if name == "lab_vm_type":
        type_text(arguments["text"])
        return [{"type": "text", "text": "typed"}]
    if name == "lab_vm_key":
        hmp(f"sendkey {arguments['keys']}")
        return [{"type": "text", "text": "sent"}]
    if name == "lab_vm_reset":
        qmp("system_reset")
        return [{"type": "text", "text": "reset"}]
    if name == "lab_vm_snapshot":
        command = "savevm" if arguments["action"] == "save" else "loadvm"
        hmp(f"{command} {arguments['name']}")
        return [{"type": "text", "text": f"{arguments['action']}d {arguments['name']}"}]
    raise RuntimeError(f"unknown tool {name}")


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            method = request.get("method")
            request_id = request.get("id")
            if method == "initialize":
                respond(request_id, {"protocolVersion": request.get("params", {}).get("protocolVersion", "2025-03-26"), "capabilities": {"tools": {}}, "serverInfo": {"name": "codex-lab", "version": "0.1.0"}})
            elif method == "tools/list":
                respond(request_id, {"tools": TOOLS})
            elif method == "tools/call":
                params = request["params"]
                respond(request_id, {"content": call_tool(params["name"], params.get("arguments", {}))})
            elif request_id is not None:
                respond(request_id, {})
        except Exception as error:
            log(str(error))
            if 'request_id' in locals() and request_id is not None:
                respond(request_id, error=str(error))


if __name__ == "__main__":
    main()
