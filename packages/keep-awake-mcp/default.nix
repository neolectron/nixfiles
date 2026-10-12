{
  lib,
  buildNpmPackage,
  makeWrapper,
  nodejs_24,
  systemd,
}:
buildNpmPackage {
  pname = "keep-awake-mcp";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ./.;
    filter =
      path: _:
      !(lib.elem (baseNameOf path) [
        "node_modules"
        "dist"
        "result"
      ]);
  };
  nodejs = nodejs_24;
  npmDepsHash = "sha256-sWVzUbnF5SAAdyRIqbvWJxmxCKcVidKGa8A8ForcBDw=";
  npmInstallFlags = [ "--ignore-scripts" ];
  nativeBuildInputs = [ makeWrapper ];

  postPatch = ''
    substituteInPlace src/backend.ts \
      --replace-fail '@systemdInhibit@' '${systemd}/bin/systemd-inhibit'
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test dist/test/*.test.js
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --ignore-scripts --offline
    packageDirectory="$out/lib/keep-awake-mcp"
    mkdir -p "$packageDirectory/dist" "$out/bin"
    cp package.json "$packageDirectory/"
    cp -r node_modules "$packageDirectory/"
    cp -r dist/src "$packageDirectory/dist/"
    makeWrapper ${lib.getExe nodejs_24} "$out/bin/keep-awake-mcp" \
      --add-flags "$packageDirectory/dist/src/server.js"
    runHook postInstall
  '';

  meta = {
    description = "Local TypeScript MCP server for temporary, independently owned sleep inhibition";
    mainProgram = "keep-awake-mcp";
    platforms = lib.platforms.linux;
  };
}
