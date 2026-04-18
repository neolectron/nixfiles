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

    # No nixpkgs.follows — lets us hit their cachix binary caches
    niri.url = "github:sodiboo/niri-flake";
    noctalia.url = "github:noctalia-dev/noctalia-shell";
    vicinae.url = "github:vicinaehq/vicinae";

    # No cachix binary caches, but we want to be able to override them with our own nixpkgs
    envisaged = {
      url = "github:utensils/Envisaged";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    handy = {
      url = "github:cjpais/Handy";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        inputs.flake-parts.flakeModules.modules
        inputs.home-manager.flakeModules.home-manager
      ]
      ++ (inputs.import-tree ./flakes).imports
      ++ (inputs.import-tree ./hosts).imports;
    };
}
