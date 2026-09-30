{
  fetchurl,
  lib,
  makeBinaryWrapper,
  ripgrep,
  stdenvNoCC,
  wayland,
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode-v2";
  version = "2.0.18";

  src = fetchurl {
    url = "https://registry.npmjs.org/@opencode/cli-linux-x64/-/cli-linux-x64-${finalAttrs.version}.tgz";
    hash = "sha512-94dH7lwB+tpmzI1/NIfzFxLBIeshZSNtyx2sskL0C0kgYjMaiVMIHvQLYIECUOWSuVz5/dH/KPUIOGn7ML311g==";
  };

  # Patching the Bun executable strips its embedded OpenCode payload.
  # frostbit's nix-ld runs the upstream binary unchanged.
  nativeBuildInputs = [ makeBinaryWrapper ];

  unpackPhase = ''
    runHook preUnpack
    tar -xzf "$src"
    runHook postUnpack
  '';

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 package/bin/opencode "$out/bin/opencode"
    runHook postInstall
  '';

  postFixup = ''
    wrapProgram "$out/bin/opencode" \
      --prefix PATH : ${lib.makeBinPath [ ripgrep ]} \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
  '';

  meta = {
    description = "OpenCode 2 AI coding agent";
    homepage = "https://opencode.ai/v2";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "opencode";
  };
})
