{ lib, writeShellApplication, python3, nix }:
writeShellApplication {
  name = "codex-lab-mcp";
  runtimeInputs = [ python3 nix ];
  text = ''
    exec ${python3}/bin/python3 ${./server.py}
  '';
  meta = {
    description = "MCP control bridge for the frostbit-lab QEMU guest";
    mainProgram = "codex-lab-mcp";
    platforms = lib.platforms.linux;
  };
}
