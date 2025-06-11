{ config, pkgs, ... }:

{
  home.packages = with pkgs; [ spotify-tray ];
  programs.waybar = {
    enable = true;
    systemd.enable = true;
    settings.mainBar = {
      layer = "top";
      position = "top";
      all-outputs = true;
      height = 24;

      # Modules layout
      modules-left = [ "hyprland/workspaces" "wlr/taskbar" "hyprland/submap" ];
      modules-center = [ "hyprland/window" ];
      modules-right = [ "tray" "network" "pulseaudio" "clock" ];

      # Modules settings
      "hyprland/workspaces" = {
        all-outputs = false;
        on-scroll-up = "hyprctl dispatch workspace e+1";
        on-scroll-down = "hyprctl dispatch workspace e-1";
        format = "{icon}";
        format-icons = {
          # default = "";
          urgent = "";
          # active = ""; # focused workspace on current monitor
          # visible = ""; # focused workspace on others monitor
          empty = ""; # persistent (created by split-monitor-workspaces plugin)
        };
      };

      "wlr/taskbar" = {
        format = "{icon}";
        max-length = 30;
        tooltip = true;
        actions = {
          on-click = "focus";
          on-click-middle = "close";
          on-scroll-up = "scroll_up";
          on-scroll-down = "scroll_down";
        };
      };

      "hyprland/submap" = {
        format = "✌️ {}";
        max-length = 8;
        tooltip = true;
      };

      "hyprland/window" = {
        separate-outputs = true;
        format = "<span font='9' rise='-4444'>{}</span>";
      };

      tray = {
        icon-size = 21;
        spacing = 10;
      };

      network = {
        interval = 5;
        format-connected =
          "<span color='#99ffdd'>{bandwidthDownBytes} {bandwidthUpBytes}</span>";
        format-disconnected = "<span color='#ff6699'>睊</span>";
        format-ethernet =
          "<span color='#fff'>{bandwidthDownBytes} {bandwidthUpBytes}</span>";
      };

      pulseaudio = {
        # add speaker icon in format
        format = "<span color='#99ffdd'></span>   {volume}%";
        # format = " {volume}%";
        format-muted = "";
        on-click = "pavucontrol";
        on-click-right = "helvum";
      };

      clock = {
        format = "<span color='#ffcc66'><b></b></span>  {:%H:%M}";
        format-alt = "{:%A, %B %d, %Y (%R)}  ";
        tooltip-format = "<tt><small>{calendar}</small></tt>";
        calendar = {
          mode = "month";
          mode-mon-col = 3;
          weeks-pos = "right";
          on-scroll = 1;
          format = {
            months = "<span color='#ffead3'><b>{}</b></span>";
            days = "<span color='#ecc6d9'><b>{}</b></span>";
            # weeks = "<span color='#99ffdd'><b>W{}</b></span>";
            weekdays = "<span color='#ffcc66'><b>{}</b></span>";
            today = "<span color='#ff6699'><b><u>{}</u></b></span>";
          };
        };
        actions = {
          on-click-right = "mode";
          on-scroll-up = "tz_up";
          on-scroll-down = "tz_down";
          on-click = "shift_up";
          on-double-click = "shift_down";
        };
      };
    };

    style = ''
      * {
        border: none;
        min-height: 0;
        transition-duration: 0.2s;
      }

      /* All module */
      #workspaces,
      #taskbar,
      #submap,
      #window,
      #tray,
      #network,
      #pulseaudio,
      #clock {
        margin-left: 5px;
        margin-right: 5px;
      }

      #waybar {
        color: #ffffff;
        background: rgba(0, 0, 0, 0.5);
      }

      tooltip {
        background: rgba(0, 0, 0, 0.6);
      }

      tooltip label {
        color: #ffffff;
      }

      #workspaces button {
        all: initial;
        min-width: 15px;
        padding: 0 5px 0 5px;
        background: transparent;
        color: white;
        border-bottom: 1px solid transparent;
      }

      #workspaces button:hover {
        border-bottom: 1px solid white;
        background: rgba(255, 255, 255, 0.1);
      }

      #workspaces button.empty {
        border-bottom: 1px solid black;
      }

      #workspaces button.visible {
        border-bottom: 1px solid white;
      }

      #workspaces button.active {
        border-bottom: 1px solid white;
      }

      #workspaces button.urgent {
        background-color: #e78a4e;
      }

      #taskbar {
        outline: 1px solid #ffffff;
      }

      #taskbar > button {
        all: initial;
        padding: 0 5px;
        background: transparent;
        color: white;
        border-bottom: 1px solid transparent;
      }

      #taskbar > button:hover {
        border-bottom: 1px solid white;
        background: rgba(255, 255, 255, 0.1);
      }

      #tray > div:hover {
        border-bottom: 1px solid white;
        background: rgba(255, 255, 255, 0.1);
      }

      #tray > .passive {
        -gtk-icon-effect: dim;
      }

      #tray > .needs-attention {
        -gtk-icon-effect: highlight;
        background-color: #eb4d4b;
      }

    '';
  };
}
