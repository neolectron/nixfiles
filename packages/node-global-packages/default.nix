{
  lib,
  buildNpmPackage,
  makeWrapper,
  nodejs_24,
}:

buildNpmPackage {
  pname = "node-global-packages";
  version = "0.1.0";
  src = ./.;

  # Keep the default CLI runtime independent from repository-specific Node.js
  # versions selected by a dev shell.
  nodejs = nodejs_24;

  npmDepsHash = "sha256-O9LuAqeKEVbXTj79V/yACl+wpmRC9OrPk371u8GtOk8=";
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    packageDirectory="$out/lib/node_modules/node-global-packages"
    mkdir -p "$packageDirectory" "$out/bin"
    cp package.json package-lock.json "$packageDirectory/"
    cp -R node_modules "$packageDirectory/"

    # Expose only binaries declared by direct dependencies from the manifest,
    # not helper binaries pulled in transitively.
    node --input-type=module > "$TMPDIR/node-global-bins" <<'NODE'
    import fs from "node:fs";

    const root = JSON.parse(fs.readFileSync("package.json"));
    for (const packageName of Object.keys(root.dependencies ?? {})) {
      const packageJson = JSON.parse(
        fs.readFileSync(`node_modules/''${packageName}/package.json`)
      );
      const bins =
        typeof packageJson.bin === "string"
          ? { [packageName.split("/").at(-1)]: packageJson.bin }
          : packageJson.bin ?? {};

      for (const [name, target] of Object.entries(bins)) {
        process.stdout.write(name + "\t" + packageName + "\t" + target + "\n");
      }
    }
NODE

    while IFS=$'\t' read -r name packageName target; do
      makeWrapper ${lib.getExe nodejs_24} "$out/bin/$name" \
        --add-flags "$packageDirectory/node_modules/$packageName/$target"
    done < "$TMPDIR/node-global-bins"

    runHook postInstall
  '';

  meta = {
    description = "Declaratively managed npm command-line packages";
    homepage = "https://www.npmjs.com/";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
  };
}
