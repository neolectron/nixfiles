{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
  bubblewrap,
  ripgrep,
}:

let
  arch = "x86_64-unknown-linux-musl";
  releaseBase = "https://github.com/openai/codex/releases/download";
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "codex";
  version = "0.166.0";

  srcs = [
    (fetchurl {
      url = "${releaseBase}/rust-v${finalAttrs.version}/codex-${arch}.tar.gz";
      hash = "sha256-oL9XLS+T8FbGcSpto0jpYHjchPOIX9e+Z4B+84nLOXg=";
    })
    (fetchurl {
      url = "${releaseBase}/rust-v${finalAttrs.version}/codex-code-mode-host-${arch}.tar.gz";
      hash = "sha256-dYgzT9R7xAA9lwtw39TR5FeEkbHpuqcpdqTC1+l1kNo=";
    })
  ];

  nativeBuildInputs = [ makeWrapper ];

  sourceRoot = ".";

  unpackPhase = ''
    runHook preUnpack
    for s in $srcs; do
      tar -xzf "$s"
    done
    runHook postUnpack
  '';

  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 codex-${arch} "$out/bin/codex"
    install -Dm755 codex-code-mode-host-${arch} "$out/bin/codex-code-mode-host"

    runHook postInstall
  '';

  postFixup = ''
    wrapProgram "$out/bin/codex" \
      --prefix PATH : ${lib.makeBinPath [ bubblewrap ripgrep ]}
  '';

  meta = {
    description = "Lightweight coding agent that runs in your terminal";
    homepage = "https://github.com/openai/codex";
    changelog = "https://github.com/openai/codex/releases/tag/rust-v${finalAttrs.version}";
    license = lib.licenses.asl20;
    mainProgram = "codex";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
})
