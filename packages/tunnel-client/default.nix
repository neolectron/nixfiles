{
  lib,
  stdenvNoCC,
  fetchurl,
  unzip,
  cacert,
}:
stdenvNoCC.mkDerivation {
  pname = "tunnel-client";
  version = "0.0.18";

  # Official release includes its matching, statically linked cloudflared companion.
  src = fetchurl {
    url = "https://github.com/openai/tunnel-client/releases/download/v0.0.18/tunnel-client-v0.0.18-linux-amd64.zip";
    hash = "sha256-PIIwcxas2TyIo4S2KvHYHT9MsO+pdfnAv675IoZqBMQ=";
  };
  nativeBuildInputs = [ unzip ];
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  # Both upstream executables are static ELF; preserve their release bytes.
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 tunnel-client "$out/bin/tunnel-client"
    install -Dm755 cloudflared "$out/bin/cloudflared"
    install -Dm644 cloudflared-manifest.json "$out/bin/cloudflared-manifest.json"
    install -Dm644 LICENSE "$out/share/licenses/tunnel-client/LICENSE"
    install -Dm644 NOTICE "$out/share/licenses/tunnel-client/NOTICE"
    install -Dm644 *-licenses.txt "$out/share/licenses/tunnel-client/dependencies.txt"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
    "$out/bin/tunnel-client" --version
    "$out/bin/tunnel-client" cloudflared version
    "$out/bin/tunnel-client" run --help > /dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Official OpenAI Secure MCP Tunnel client and matching companion";
    homepage = "https://github.com/openai/tunnel-client";
    license = lib.licenses.asl20;
    platforms = [ "x86_64-linux" ];
    mainProgram = "tunnel-client";
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
