{
  lib,
  runCommand,
  writeTextFile,
  python3,
  tunnelClient,
  dataDirectory,
  dshHome,
  nodeExecutable,
}:
let
  units = import ./units.nix {
    inherit
      dataDirectory
      dshHome
      nodeExecutable
      tunnelClient
      ;
  };
  # Match Home Manager's pinned systemd generator, including repeated directives.
  toSystemdIni = lib.generators.toINI {
    listsAsDuplicateKeys = true;
    mkKeyValue =
      key: value: "${key}=${if builtins.isBool value then lib.boolToString value else toString value}";
  };
  unitFiles = lib.mapAttrs (
    name: unit:
    writeTextFile {
      name = "${name}-unit";
      destination = "/${name}.service";
      text = toSystemdIni unit;
    }
  ) units;
in
runCommand "dsh-mcp-service-files" { nativeBuildInputs = [ python3 ]; } ''
  mkdir -p "$out/share/systemd/user"
  ${lib.concatStringsSep "\n" (
    lib.mapAttrsToList (
      name: source: ''ln -s "${source}/${name}.service" "$out/share/systemd/user/${name}.service"''
    ) unitFiles
  )}
  python3 ${./test.py} "$out/share/systemd/user"
''
