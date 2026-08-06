# Caveat: wrapping OBS to force `QT_QPA_PLATFORM=xcb`

## Why

OBS Studio on Wayland is missing features we need (e.g. certain capture modes
under niri). Forcing the X11 (xcb) Qt platform runs OBS under XWayland, which
restores them. We want this to apply for **both** the desktop launcher and a
direct `obs` CLI invocation.

## How it's wired

The HM `programs.obs-studio` module is implemented in:

    /nix/store/.../modules/programs/obs-studio.nix

It exposes a `package` option and a read-only `finalPackage`:

    config = lib.mkIf cfg.enable {
      home.packages = [ cfg.finalPackage ];
      programs.obs-studio.finalPackage =
        pkgs.wrapOBS.override { obs-studio = cfg.package; } { inherit (cfg) plugins; };
    };

`pkgs.wrapOBS` is `pkgs/applications/video/obs-studio/wrapper.nix` — a
`symlinkJoin` of `[ obs-studio ] ++ plugins` followed by:

    wrapProgram $out/bin/obs \
      --set OBS_PLUGINS_PATH     "${pluginsJoined}/lib/obs-plugins" \
      --set OBS_PLUGINS_DATA_PATH "${pluginsJoined}/share/obs/obs-plugins"

So the HM module *re-wraps* whatever `cfg.package` points to with the plugin
env. Any custom wrapping you want to keep must therefore be applied to
`programs.obs-studio.package`, **not** to the final package.

## Why injecting into `programs.obs-studio.package` survives

`wrapProgram` (from `make-shell-wrapper-hook` / `makeWrapper`) is:

    wrapProgramShell() {
        local prog="$1" hidden ...
        hidden="$(dirname "$prog")/.$(basename "$prog")"-wrapped
        while [ -e "$hidden" ]; do hidden="${hidden}_"; done
        mv "$prog" "$hidden"
        makeShellWrapper "$hidden" "$prog" --inherit-argv0 "${@:2}"
    }

i.e. it **moves the existing file/symlink aside** and creates a new wrapper
that calls the moved file. In `wrapOBS`, `$prog` is a symlink (because of
`symlinkJoin`) to whatever `cfg.package` installed. `mv` relocates the
symlink and the new wrapper execs it via the moved path. **The inner wrapper
script set is preserved and runs in the chain.** This is what allows stacked
wrappers to compose.

## Implementation in `flakes/obs.nix`

    package = lib.mkDefault (
      pkgs.symlinkJoin {
        name = "obs-studio-qt-xcb";
        paths = [ pkgs.obs-studio ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''wrapProgram $out/bin/obs --set QT_QPA_PLATFORM xcb'';
        meta = pkgs.obs-studio.meta // { mainProgram = "obs"; };
      }
    );

`mkDefault` follows the AGENTS.md leaf-value discipline — a host can override
`programs.obs-studio.package` with a plain assignment (priority 100 beats
mkDefault's 1000) without having to fight lib's defaults.

## Verified chain (built `frostbit` HM `finalPackage`)

Running `$out/bin/obs` cascades through:

1. outermost wrapper (`obs`)                         — sets OBS_PLUGINS_PATH +
                                                       gstreamer plugin paths
2. `.obs-wrapped__`  -> our qt-xcb wrapper           — export QT_QPA_PLATFORM='xcb'
3. `.obs-wrapped_`   -> obs-studio-<ver>/bin/obs     — Qt wrapper from
                                                       wrapQtAppsHook
                                                       (QT_PLUGIN_PATH,
                                                        LD_LIBRARY_PATH,
                                                        gapps env, ...)
4. real obs-studio binary                            — inherits *all* stacked env

Verified (after a real build) by `cat $out/bin/.obs-wrapped__`:

    #!/nix/store/.../bash -e
    export QT_QPA_PLATFORM='xcb'
    exec -a "$0" ".../obs-studio-qt-xcb/bin/.obs-wrapped_"  "$@"

`grep QT_QPA_PLATFORM $out/bin/*` at the *outermost* level shows nothing — the
env is set one layer down; that's expected and correct, since the outermost
wrapper eventually calls the inner one which sets the env before invoking the
Qt wrapper and the real binary.

## Alternatives considered

- **`xdg.desktopEntries."com.obsproject.Studio".exec = "env QT_QPA_PLATFORM=xcb obs"`:**
  Would only fix launcher-based invocations, not a direct `obs` in a shell.
  Skip.
- **`pkgs.obs-studio.overrideAttrs` extending `qtWrapperArgs` via `preFixup`:**
  Works (Qt wrapper would set the env), but harder to read than an explicit
  `wrapProgram --set`. Keep the symlinkJoin approach.
- **`home.sessionVariables.QT_QPA_PLATFORM = "xcb"`:** would force *every* Qt
  app on the system to X11 — too broad. Don't.

## Rebuild / apply

    nixos-rebuild switch --flake .#frostbit --sudo