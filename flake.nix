{
  inputs = {
    # Frameworks
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    import-tree.url = "github:vic/import-tree";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-index-database = {
      url = "github:nix-community/nix-index-database";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Niri is built with the host packages by its NixOS module.
    niri.url = "github:sodiboo/niri-flake";
    # Noctalia loads the host Mesa driver into its process; its glibc must match.
    noctalia = {
      url = "github:noctalia-dev/noctalia/v5.5.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Built with the host packages so it loads the system Mesa driver: a GL app
    # carrying its own Mesa must export it to every program it launches.
    vicinae = {
      url = "github:vicinaehq/vicinae";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    vicinae-extensions = {
      url = "github:vicinaehq/extensions";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.vicinae.follows = "vicinae";
    };

    # Same reason as Vicinae: the host Mesa, not a private one.
    spotifast = {
      url = "github:crmne/spotifast";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Nixvim - Neovim configuration framework
    # Note: Not using follows as recommended by nixvim docs for compatibility
    nixvim = {
      url = "github:nix-community/nixvim";
    };

    codex-desktop-linux = {
      url = "github:ilysenko/codex-desktop-linux";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    zerofetch = {
      url = "github:peachey2k2/0fetch";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.flake-parts.flakeModules.modules
        inputs.home-manager.flakeModules.home-manager
        (inputs.import-tree ./flakes)
        (inputs.import-tree ./flakes/desktop-environment)
        (inputs.import-tree ./hosts)
      ];
    };
}
