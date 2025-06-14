{ config, lib, pkgs, systemSettings ? {}, userSettings ? {}, ... }:
{
  # System-level Hyprland configuration
  programs.hyprland = {
    enable = lib.mkDefault true;
    xwayland.enable = lib.mkDefault true;
  };

  # Required packages for Hyprland
  environment.systemPackages = with pkgs; [
    kitty # required for the default Hyprland config
    grimblast # for screenshots
    wl-clipboard # for clipboard functionality
    rofi-wayland # application launcher
  ];

  # Home Manager configuration
  home-manager.users.${userSettings.username} = {
    programs.wlogout = {
      enable = true;
      # style = '' '';
    };
    
    home.sessionVariables.NIXOS_OZONE_WL = "1";
    wayland.windowManager.hyprland = {
      enable = true;
      # Use the Hyprland package from the NixOS module to avoid version conflicts
      package = null;
      portalPackage = null;
      systemd = {
        enable = true;
        # Import all environment variables to systemd services (fixes hypridle, etc.)
        variables = ["--all"];
      };
      xwayland.enable = true;
      plugins = with pkgs; [
        hyprlandPlugins.csgo-vulkan-fix
        hyprlandPlugins.hyprtrails
        # split-monitor-workspaces
      ];

      settings = {
        monitor = [
          "HDMI-A-1,1920x1080@60,0x0,1" # Left
          "DP-2,1920x1080@60,1920x0,1" # Right
        ];
        input = {
          kb_layout = "fr";
          kb_variant = "us";
        };

        exec-once = [ "hyprctl setcursor Qogir 24" ];

        "$mod" = "SUPER";
        bindm = [
          "$mod, mouse:272, movewindow"
          "$mod, mouse:273, resizewindow"
          "$mod ALT, mouse:272, resizewindow"
        ];
        bind = [
          "$mod, Q, killactive,"
          "$mod, W, exec, systemctl --user restart waybar"
          "$mod, F, fullscreen,"
          "$mod SHIFT, F, togglefloating,"
          "$mod, space, exec, rofi -show run"
          "$mod, Escape, exec, wlogout"
          "$mod, L, exec, loginctl lock-session"
          "$mod, T, exec, kitty"
          # Arrows move focus
          "$mod, left, movefocus, l"
          "$mod, right, movefocus, r"
          "$mod, up, movefocus, u"
          "$mod, down, movefocus, d"
          # Shift + Arrows move windows
          "$mod SHIFT, left, movewindow, l"
          "$mod SHIFT, right, movewindow, r"
          "$mod SHIFT, up, movewindow, u"
          "$mod SHIFT, down, movewindow, d"
          # Ctrl + Arrow scroll across workspaces
          "$mod CTRL, left, workspace, prev"
          "$mod CTRL, right, workspace, next"
          # Ctrl + Shift + Arrow move window across workspaces
          "$mod CTRL SHIFT, left, movetoworkspace, prev"
          "$mod CTRL SHIFT, right, movetoworkspace, next"
          #
          ", Print, exec, grimblast --notify copysave area"
          ## TODO: send notification when screenshot is saved
          ## TODO: open screenshot in editor when notification is clicked
        ] ++ (
          # workspaces binds $mod + [shift +] {1..9} to [move to] workspace {1..9}
          builtins.concatLists (builtins.genList (i:
            let ws = i + 1;
            in [
              "$mod, code:1${toString i}, workspace, ${toString ws}"
              "$mod SHIFT, code:1${toString i}, movetoworkspace, ${toString ws}"
            ]) 9));
        decoration = { rounding = 8; };
        misc = {
          # disable_autoreload = true;
          force_default_wallpaper = 0;
          vrr = 1; # Variable Refresh Rate.
        };
      };
    };
  };
}
