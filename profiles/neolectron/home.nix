{ pkgs, userSettings, ... }: {
  # Define a user account. Don't forget to set a password with ‘passwd’.
  # users.users.neolectron = {
  #   isNormalUser = true;
  #   initialPassword = "password";
  #   shell = pkgs.zsh;
  #   extraGroups = [ "wheel" ]; # Enable ‘sudo’
  # };

    programs.home-manager.enable = true;
    home.stateVersion = "25.05"; # Do not change after first installation.
    home.username = userSettings.username;
    home.homeDirectory = "/home/" + userSettings.username;
    home.sessionVariables = {
      EDITOR = userSettings.editor;
      #SPAWNEDITOR = userSettings.spawnEditor;
      #TERM = userSettings.term;
      #BROWSER = userSettings.browser;
    };


    imports = [
      ../../apps/desktop-environment/rofi.nix
      ../../apps/desktop-environment/waybar.nix
      ../../apps/zsh.nix
    ];

    home.packages = with pkgs; [
        # Core packages
        zsh
        git
        vim
        wget
        qwerty-fr
        nixfmt-classic
        jq
        htop

        # Desktop environment
        qogir-icon-theme
        grimblast
        wl-clipboard
        dunst

        # Softwares
        kitty
        google-chrome
        discord
        spotify
        vscode
        # vscodium
    ];

    # programs.git = {
    #   enable = true;
    #   userName = "neolectron";
    #   userEmail = "neolectron@codinglab.io";
    # };

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


    xdg.enable = true;
    xdg.userDirs = {
      enable = true;
      createDirectories = true;
      # music = "${config.home.homeDirectory}/Media/Music";
      # videos = "${config.home.homeDirectory}/Media/Videos";
      # pictures = "${config.home.homeDirectory}/Media/Pictures";
      # templates = "${config.home.homeDirectory}/Templates";
      # download = "${config.home.homeDirectory}/Downloads";
      # documents = "${config.home.homeDirectory}/Documents";
      desktop = null;
      publicShare = null;
      extraConfig = {
        # XDG_DOTFILES_DIR = "${config.home.homeDirectory}/.dotfiles";
        # XDG_ARCHIVE_DIR = "${config.home.homeDirectory}/Archive";
        # XDG_VM_DIR = "${config.home.homeDirectory}/Machines";
        # XDG_ORG_DIR = "${config.home.homeDirectory}/Org";
        # XDG_PODCAST_DIR = "${config.home.homeDirectory}/Media/Podcasts";
        # XDG_BOOK_DIR = "${config.home.homeDirectory}/Media/Books";
        # XDG_GAME_DIR = "${config.home.homeDirectory}/Media/Games";
        # XDG_GAME_SAVE_DIR = "${config.home.homeDirectory}/Media/Game Saves";
      };
    };

    xdg.mime.enable = true;
    xdg.mimeApps.enable = true;
    xdg.mimeApps.associations.added = {
      # TODO fix mime associations, most of them are totally broken :(
      "application/octet-stream" = "flstudio.desktop;";
    };
  }

