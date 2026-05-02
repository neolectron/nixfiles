{ config, ... }:
let
  username = config.flake.username;
in
{
  # NixOS side: *arr media automation stack
  # Prowlarr (indexer manager) + Sonarr (TV/anime) + Radarr (movies) + qBittorrent (torrent client) + Bazarr (subtitles)
  #
  # Web UIs after setup:
  #   Prowlarr:    http://localhost:9696  — add nyaa.si and other indexers here
  #   Sonarr:      http://localhost:8989  — manage TV shows / anime
  #   Radarr:      http://localhost:7878  — manage movies
  #   qBittorrent: http://localhost:8080  — torrent client (VueTorrent UI)
  #   Bazarr:      http://localhost:6765  — automatic subtitles (FR + EN)
  #
  # Setup order:
  #   1. qBittorrent — set download path to ~/Videos/Library/downloads
  #   2. Prowlarr    — add indexers (nyaa.si, etc.), then connect to Sonarr & Radarr
  #   3. Sonarr      — set root folder ~/Videos/Library/Anime, connect to qBittorrent
  #   4. Radarr      — set root folder ~/Videos/Library/Movies, connect to qBittorrent
  flake.modules.nixos.mediaStack =
    { lib, pkgs, ... }:
    {
      # ── Jellyfin: media server ────────────────────────────────
      # Shared group so Jellyfin, Sonarr, Radarr, qBittorrent can all access media files
      users.groups.media = { };
      users.users.${username}.extraGroups = [ "media" ];

      services.jellyfin = {
        enable = lib.mkDefault true;
        user = lib.mkDefault username;
        group = lib.mkDefault "media";
        openFirewall = lib.mkDefault true; # ports 8096 (HTTP) and 8920 (HTTPS)

        # AMD VAAPI hardware transcoding
        hardwareAcceleration = {
          enable = lib.mkDefault true;
          type = lib.mkDefault "vaapi";
          device = lib.mkDefault "/dev/dri/renderD128";
        };
      };

      # ── Prowlarr: indexer manager (replaces Jackett) ──────────
      # Add nyaa.si and any other torrent trackers here.
      # Prowlarr syncs indexers to Sonarr/Radarr automatically.
      services.prowlarr = {
        enable = lib.mkDefault true;
        openFirewall = lib.mkDefault true; # port 9696
      };

      # ── Sonarr: TV shows & anime manager ─────────────────────
      services.sonarr = {
        enable = lib.mkDefault true;
        user = lib.mkDefault username;
        group = lib.mkDefault "media";
        openFirewall = lib.mkDefault true; # port 8989
      };

      # ── Radarr: movie manager ────────────────────────────────
      services.radarr = {
        enable = lib.mkDefault true;
        user = lib.mkDefault username;
        group = lib.mkDefault "media";
        openFirewall = lib.mkDefault true; # port 7878
      };

      # ── Bazarr: automatic subtitle downloader ───────────────
      # Web UI: http://localhost:6765
      #
      # FIRST-TIME SETUP (via web UI):
      #   1. Go to Settings → Sonarr
      #      - Add Sonarr: URL http://localhost:8989, API key from Sonarr Settings→General
      #   2. Go to Settings → Providers
      #      - Enable: OpenSubtitles (free account at opensubtitles.com), Subscene, Addic7ed
      #   3. Go to Settings → Languages
      #      - Add and enable: English, French
      #   4. Go to Series tab
      #      - Find "Parks and Recreation", enable subtitle monitoring
      #
      services.bazarr = {
        enable = lib.mkDefault true;
        user = lib.mkDefault username;
        group = lib.mkDefault "media";
        openFirewall = lib.mkDefault true; # port 6765
        listenPort = lib.mkDefault 6765;
      };

      # Allow all media services to access ~/Videos/Library
      # (systemd sets ProtectHome=yes by default, blocking /home entirely)
      systemd.services.qbittorrent.serviceConfig = {
        ProtectHome = lib.mkForce "tmpfs";
        BindPaths = [ "/home/${username}/Videos/Library" ];
      };
      systemd.services.sonarr.serviceConfig = {
        ProtectHome = lib.mkForce "tmpfs";
        BindPaths = [ "/home/${username}/Videos/Library" ];
      };
      systemd.services.radarr.serviceConfig = {
        ProtectHome = lib.mkForce "tmpfs";
        BindPaths = [ "/home/${username}/Videos/Library" ];
      };
      systemd.services.bazarr.serviceConfig = {
        ProtectHome = lib.mkForce "tmpfs";
        BindPaths = [ "/home/${username}/Videos/Library" ];
      };

      services.qbittorrent = {
        enable = lib.mkDefault true;
        user = lib.mkDefault username;
        group = lib.mkDefault "media";
        openFirewall = lib.mkDefault true; # web UI 8080 + torrenting port
        webuiPort = lib.mkDefault 8080;
        torrentingPort = lib.mkDefault 6881;

        serverConfig = {
          LegalNotice.Accepted = true;
          Preferences = {
            WebUI = {
              # Use native web UI — Vuetorrent served separately via nginx
              # so both frontends connect to the same qBittorrent backend
              AlternativeUIEnabled = false;
              # Allow connection via nginx reverse proxy
              HostHeaderValidation = false;
              Username = "admin";
              # PBKDF2 hash of "password" — change via web UI after first login
              "Password_PBKDF2" =
                "@ByteArray(x6USfliIDoKH1xH4lXuO1Q==:eN/oDd1HrfjN/7lPvMjbFdAoueiKz8FaW2Tx4YmQayB7WtNFG2WqQiHCAcEhpFwUzQY5Wih25SvZvcAOKxX1+A==)";
              # Disable IP ban on failed login attempts (localhost-only service, ban is just annoying)
              MaxAuthenticationFailCount = 0;
            };
            Downloads = {
              SavePath = "/home/${username}/Videos/Library/downloads";
            };
            Bittorrent = {
              # MaxRatio = -1 means no limit (seed forever). Set to e.g. 1 to stop at 1:1 ratio.
              MaxRatio = -1;
            };
          };
        };
      };

      # ── nginx: reverse proxy serving both VueTorrent static files and qBittorrent API ────
      # Access: http://localhost/          → VueTorrent (default)
      #        http://localhost/api/*  → qBittorrent API
      #        http://localhost:8080    → Native qBittorrent UI
      services.nginx = {
        enable = lib.mkDefault true;
        recommendedProxySettings = true;
        virtualHosts = {
          "localhost" = {
            # Serve VueTorrent static frontend at root
            locations."/" = {
              root = "${pkgs.vuetorrent}/share/vuetorrent";
            };
            # Proxy API calls to qBittorrent so VueTorrent can communicate with backend
            locations."/api/" = {
              proxyPass = "http://127.0.0.1:8080";
            };
          };
        };
      };
      # Deploy Vuetorrent static files for nginx to serve
      systemd.services.nginx = {
        serviceConfig = {
          ProtectHome = lib.mkForce "tmpfs";
          BindPaths = [ "${pkgs.vuetorrent}/share/vuetorrent" ];
        };
      };
    };
}
