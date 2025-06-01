{ config, pkgs, ... }: {
  home.packages = with pkgs; [ qogir-icon-theme grimblast wl-clipboard ];
  programs.wlogout = {
    enable = true;
    # style = '' '';
  };
  wayland.windowManager.hyprland = {
    enable = true;
    systemd.enable = true;
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
        "$mod, F, fullscreen,"
        "$mod SHIFT, F, togglefloating,"
        "$mod, space, exec, rofi -show run"
        "$mod, Escape, exec, wlogout"
        "$mod, L, exec, loginctl lock-session"
        "$mod, T, exec, kitty"
        #
        "$mod, left, movefocus, l"
        "$mod, right, movefocus, r"
        "$mod, up, movefocus, u"
        "$mod, down, movefocus, d"
        #
        ", Print, exec, grimblast --notify copysave area"
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
}
