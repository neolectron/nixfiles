{
  lib,
  stdenv,
  fetchFromGitHub,
  swift,
  swiftpm,
  makeWrapper,
  bash,
  zsh,
  bitwarden-cli,
  coreutils,
  wl-clipboard,
  xclip,
  xdg-utils,
  python3,
}:
stdenv.mkDerivation {
  pname = "secret";
  version = "2.0.0-unstable-2026-09-26";

  # Match astahmer/nixfiles a142d48's source pin without importing that
  # machine's private/unrelated flake inputs or personal vault references.
  src = fetchFromGitHub {
    owner = "astahmer";
    repo = "secret-cli";
    rev = "fe4af4af2b9f7504600e37e373905f8b1b25727b";
    hash = "sha256-OGmaR8wNa4EAV0pYeFOI+pcsj7q02sM3cdA+oT9wWWI=";
  };
  patches = [ ./linux.patch ];

  nativeBuildInputs = [
    swift
    swiftpm
    makeWrapper
  ];
  nativeCheckInputs = [
    python3
    bash
    zsh
  ];
  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR/build-home"
    mkdir -p "$HOME"
    swift build --package-path secret --scratch-path "$NIX_BUILD_TOP/.build" -c release
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    substitute ${./wrapper.sh} "$TMPDIR/secret-wrapper" \
      --subst-var-by bash '${lib.getExe bash}' \
      --subst-var-by binary "$NIX_BUILD_TOP/.build/release/secret"
    chmod +x "$TMPDIR/secret-wrapper"
    python3 ${./test.py} "$NIX_BUILD_TOP/.build/release/secret" "$TMPDIR/secret-wrapper"
    bash ${./test-shell.sh} '${lib.getExe bash}' '${lib.getExe zsh}' \
      ${./shell.sh} ${./completion.bash} ${./completion.zsh} ${./init-config.sh}
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 "$NIX_BUILD_TOP/.build/release/secret" "$out/libexec/secret"
    install -Dm644 LICENSE "$out/share/licenses/secret/LICENSE"
    mkdir -p "$out/bin"
    substitute ${./wrapper.sh} "$out/bin/secret" \
      --subst-var-by bash '${lib.getExe bash}' \
      --subst-var-by binary "$out/libexec/secret"
    chmod +x "$out/bin/secret"
    wrapProgram "$out/bin/secret" --prefix PATH : '${
      lib.makeBinPath [
        bitwarden-cli
        coreutils
        wl-clipboard
        xclip
        xdg-utils
      ]
    }'
    runHook postInstall
  '';

  meta = {
    description = "Scoped Bitwarden secret aliases with the Linux-compatible upstream Swift CLI";
    homepage = "https://github.com/astahmer/secret-cli";
    license = lib.licenses.mit;
    mainProgram = "secret";
    platforms = lib.platforms.linux;
  };
}
