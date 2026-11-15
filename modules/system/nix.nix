{ ... }:
{
  flake.modules.nixos.nix =
    { ... }:
    {
      # Nix config
      nixpkgs.config.allowUnfree = true;
      nix.settings = {
        experimental-features = [
          "nix-command"
          "flakes"
        ];
        # Use all available cores for building
        max-jobs = "auto";
        # Hard-link identical files in newly built store paths
        auto-optimise-store = true;
        # niri cachix is auto-added by niri-flake.cache.enable (default true)
        extra-substituters = [
          "https://cache.nixos.org"
          "https://noctalia.cachix.org"
          "https://vicinae.cachix.org"
        ];
        extra-trusted-public-keys = [
          "cache.nixos.org-1:6NCHdP59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
          "noctalia.cachix.org-1:pCOR47nnMEo5thcxNDtzWpOxNFQsBRglJzxWPp3dkU4="
          "vicinae.cachix.org-1:1kDrfienkGHPYbkpNj1mWTr7Fm1+zcenzgTizIcI3oc="
        ];
      };
      # Weekly cleanup: drop system generations older than 14 days, then GC
      nix.gc = {
        automatic = true;
        dates = "weekly";
        options = "--delete-older-than 14d";
      };
      # Periodic dedup of the whole store, including paths built before auto-optimise
      nix.optimise.automatic = true;
      # Build parallelism is already handled by max-jobs = auto and cores = 0 (use all cores)
    };
}
