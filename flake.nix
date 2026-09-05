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

    # No nixpkgs.follows — lets us hit their cachix binary caches
    niri.url = "github:sodiboo/niri-flake";
    noctalia.url = "github:noctalia-dev/noctalia-shell/f0469d2d6f9b1ca873932dcef6583f9d6a2eee28";
    vicinae.url = "github:vicinaehq/vicinae";
    vicinae-extensions = {
      url = "github:vicinaehq/extensions";
      inputs.nixpkgs.follows = "vicinae/nixpkgs";
      inputs.vicinae.follows = "vicinae";
    };

    # No cachix binary caches, but we want to be able to override them with our own nixpkgs
    envisaged = {
      url = "github:utensils/Envisaged";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    handy = {
      url = "github:cjpais/Handy";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.bun2nix.inputs.systems.url = "github:nix-systems/x86_64-linux";
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

    _0fetch = {
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
