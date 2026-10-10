{
  lib,
  nodejs_24,
  writeShellApplication,
}:

writeShellApplication {
  name = "vtask";
  runtimeInputs = [ nodejs_24 ];
  text = ''
    exec ${nodejs_24}/bin/node ${./vtask.mjs} "$@"
  '';

  meta = {
    description = "Run simple VS Code tasks from a terminal";
    homepage = "https://code.visualstudio.com/docs/editor/tasks";
    license = lib.licenses.mit;
    mainProgram = "vtask";
    platforms = lib.platforms.linux;
  };
}
