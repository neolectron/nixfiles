{
  lib,
  stdenv,
  nodejs_24,
  pnpm_12,
  pnpmConfigHook,
  fetchPnpmDeps,
  autoPatchelfHook,
  makeWrapper,
  udev,
  libusb1,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "streamdeck-studio";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../package.json
      ../../pnpm-lock.yaml
      ../../pnpm-workspace.yaml
      ./package.json
      ./tsconfig.json
      ./src
      ./web
      ./assets
      ../system-control/package.json
      ../system-control/tsconfig.json
      ../system-control/src
    ];
  };
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname src;
    pnpm = pnpm_12;
    fetcherVersion = 4;
    hash = "sha256-s90kLISsTMQjpry7Vd88QUweqY+zE4vH/03mov11At8=";
  };
  nativeBuildInputs = [
    nodejs_24
    pnpm_12
    pnpmConfigHook
    autoPatchelfHook
    makeWrapper
  ];
  buildInputs = [
    udev
    libusb1
    stdenv.cc.cc.lib
  ];
  # The lockfile pins pnpm 12.11.2; do not download a tool during an offline build.
  pnpm_config_pm_on_fail = "ignore";
  buildPhase = ''
    runHook preBuild
    # N-API addons are patched to this package set during fixup.
    # Keep only this platform: the npm archive also includes musl/foreign binaries.
    while IFS= read -r -d "" directory; do
      find "$directory" -mindepth 1 -maxdepth 1 -type d \
        ! -name "*-linux-${stdenv.hostPlatform.node.arch}" -exec rm -r {} +
    done < <(find node_modules/.pnpm -type d -name prebuilds -print0)
    pnpm --filter @nixfiles/streamdeck exec vite build web --outDir ../web-dist
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    directory="$out/lib/streamdeck-studio"
    mkdir -p "$directory" "$out/bin"
    cp -r node_modules packages package.json "$directory/"
    makeWrapper ${lib.getExe nodejs_24} "$out/bin/streamdeck" \
      --set TSX_TSCONFIG_PATH "$directory/packages/streamdeck/tsconfig.json" \
      --add-flags "--import $directory/packages/streamdeck/node_modules/tsx/dist/loader.mjs $directory/packages/streamdeck/src/cli.ts" \
      --prefix LD_LIBRARY_PATH : ${
        lib.makeLibraryPath [
          udev
          libusb1
          stdenv.cc.cc.lib
        ]
      }
    runHook postInstall
  '';
  # Run outside the source tree: the packaged loader must find its JSX config.
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    (cd "$TMPDIR"; "$out/bin/streamdeck" preview --renderer react --output "$TMPDIR/streamdeck-preview.png")
    test -s "$TMPDIR/streamdeck-preview.png"
    runHook postInstallCheck
  '';
  meta = {
    description = "Local Stream Deck Studio, shared system controls and MCP";
    mainProgram = "streamdeck";
    platforms = lib.platforms.linux;
  };
})
