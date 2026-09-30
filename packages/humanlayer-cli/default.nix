{
  lib,
  buildFHSEnv,
  fetchurl,
  stdenvNoCC,
}:

let
  unwrapped = stdenvNoCC.mkDerivation (finalAttrs: {
    pname = "humanlayer-cli-unwrapped";
    version = "0.31.155";

    src = fetchurl {
      url = "https://registry.npmjs.org/@humanlayer/cli-linux-x64/-/cli-linux-x64-${finalAttrs.version}.tgz";
      hash = "sha512-PzLpEhXxNbxfGJlq6o+Bs6aJ4A6TALRHq1lofRUwCQpPILyOYKgsW4D+iOwjZB7IBSxTidPtXi2QcgntxqEpAg==";
    };

    sourceRoot = "package";
    dontBuild = true;

    installPhase = ''
      install -Dm755 bin/humanlayer "$out/bin/humanlayer"
    '';
  });
in
buildFHSEnv {
  name = "humanlayer";
  runScript = "${unwrapped}/bin/humanlayer";
  targetPkgs = pkgs: [ pkgs.glibc ];

  meta = {
    description = "HumanLayer CLI for daemon management and authentication";
    homepage = "https://docs.humanlayer.com/";
    changelog = "https://docs.humanlayer.com/release-notes";
    license = lib.licenses.asl20;
    mainProgram = "humanlayer";
    platforms = [ "x86_64-linux" ];
  };
}
