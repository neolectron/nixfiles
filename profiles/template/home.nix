{ config, pkgs, ... }: {
  # Define a user account. Don't forget to set a password with ‘passwd’.
  users.users.neolectron = {
    isNormalUser = true;
    initialPassword = "password";
    shell = pkgs.zsh;
    extraGroups = [ "wheel" ]; # Enable ‘sudo’
  };

  home-manager.users.neolectron = {
    programs.home-manager.enable = true;
    imports = [
      ../desktop-environment/hyprland.nix
      ../desktop-environment/waybar.nix
      ../desktop-environment/rofi.nix
      ../term/kitty.nix
      ../term/zsh.nix
    ];

    home = {
      stateVersion = "25.05"; # Installation version.
      username = "neolectron";
      homeDirectory = "/home/neolectron";
      packages = with pkgs; [ google-chrome discord spotify vscode ];
    };

    programs.git = {
      enable = true;
      userName = "neolectron";
      userEmail = "neolectron@codinglab.io";
    };

    home.file = {
      # # Building this configuration will create a copy of 'dotfiles/screenrc' in
      # # the Nix store. Activating the configuration will then make '~/.screenrc' a
      # # symlink to the Nix store copy.
      # ".screenrc".source = dotfiles/screenrc;

      # # You can also set the file content immediately.
      # ".gradle/gradle.properties".text = ''
      #   org.gradle.console=verbose
      #   org.gradle.daemon.idletimeout=3600000
      # '';
    };

    home.sessionVariables = {
      # EDITOR = "emacs";
      # Add Vulkan ICD path if needed:
      # VK_ICD_FILENAMES = "${pkgs.mesa.drivers}/share/vulkan/icd.d/intel_icd.x86_64.json";
    };
  };
}
