{
  description = "neolectron - NixOS configuration";

  outputs = { self, nixpkgs, home-manager, ... }@inputs:
    let
      # ---- SYSTEM SETTINGS ---- #
      systemSettings = {
        system = "x86_64-linux"; # system arch
        hostname = "nixos"; # hostname
        profile = "neolectron"; # select from ./profiles
        timezone = "Europe/Paris"; # select timezone
        locale = "en_US.UTF-8"; # select locale
      };
      pkgs = import nixpkgs { system = systemSettings.system; config.allowUnfree = true; };


      # ----- USER SETTINGS ----- #
      userSettings = rec {
        username = "neolectron"; # username
        name = "neolectron"; # name/identifier
        email = "neolectron@codinglab.io"; # email (used for git etc)
        theme =
          "neolectron"; # selected theme from my themes directory (./themes/)
        wm =
          "hyprland"; # Selected window manager or desktop environment; must select one in both ./user/wm/ and ./system/wm/
        browser =
          "google-chrome"; # Default browser; must select one from ./user/app/browser/
        term = "kitty"; # Default terminal command;
        font = pkgs.nerd-fonts.fira-code; # Font package
        editor = "nano";
      };
    in {
      nixosConfigurations = {
        nixos = nixpkgs.lib.nixosSystem {
          system = systemSettings.system;
          specialArgs = {
            inherit inputs;
            inherit systemSettings;
            inherit userSettings;
          };
          modules = [
            # Hardware and system configuration
            (./. + "/profiles" + ("/" + systemSettings.profile)
              + "/configuration.nix")

            # To use home-manager as a NixOS module, uncomment the following lines:
            # don't forget to comment the home-manager module in the homeConfigurations below
            home-manager.nixosModules.home-manager
            {
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                backupFileExtension = "hm-backup";
                users.${userSettings.username} = import ./profiles/neolectron/home.nix {
                  inherit pkgs;
                  inherit systemSettings;
                  inherit userSettings;
                  inherit inputs;
                };
              };
            }
          ];
        };
      };

      # Home Manager configuration
      # Uncomment this if you use home-manager standalone.
      # homeConfigurations = {
      #   user = home-manager.lib.homeManagerConfiguration {
      #     inherit pkgs;
      #     config.allowUnfree = true;
      #     modules = [
      #       # (./. + "/profiles" + ("/" + systemSettings.profile)
      #       #   + "/home.nix") # load home.nix from selected PROFILE
      #         ./profiles/neolectron/home.nix
      #     ];
      #     extraSpecialArgs = {
      #       # pass config variables from above
      #       inherit systemSettings;
      #       inherit userSettings;
      #       inherit inputs;
      #     };
      #   };
      # };
    };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}


#https://www.reddit.com/r/NixOS/comments/18eomkl/homemanager_as_nixos_module_or_as_standalone/