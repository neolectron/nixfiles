{ inputs, ... }:
{
  flake.packages.x86_64-linux =
    let
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      updateScriptZod = pkgs.callPackage ../packages/update-script-zod { };
    in
    {
      update-script-zod = updateScriptZod;

      codeburn = pkgs.callPackage ../packages/codeburn {
        inherit updateScriptZod;
      };

      droidcam-client = pkgs.callPackage ../packages/droidcam-client { };

      humanlayer-cli = pkgs.callPackage ../packages/humanlayer-cli { };

      node-global-packages = pkgs.callPackage ../packages/node-global-packages { };

      opencode-v2 = pkgs.callPackage ../packages/opencode-v2 {
        inherit updateScriptZod;
      };

      opencodex = pkgs.callPackage ../packages/opencodex {
        inherit updateScriptZod;
      };

      vtask = pkgs.callPackage ../packages/vtask { };

      wifi-audio-streaming = pkgs.callPackage ../packages/wifi-audio-streaming {
        inherit updateScriptZod;
      };
    };
}
