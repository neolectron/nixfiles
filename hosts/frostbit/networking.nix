{ ... }:
{
  flake.modules.nixos.frostbit-networking =
    { config, pkgs, ... }:
    {
      # Networking
      networking.hostName = "frostbit";
      networking.networkmanager.enable = true;
      networking.firewall.allowedTCPPorts = [ 4096 ]; # OpenCode LAN access

      # Provides the Tailscale daemon and CLI, and configures the forwarding
      # required for this machine to act as an exit node.
      services.tailscale = {
        enable = true;
        useRoutingFeatures = "server";
      };
      # Spotifast's Spotify OAuth callback needs localhost:8989.
      services.sonarr.settings.server.port = 8990;
      boot.kernel.sysctl."net.ipv6.conf.all.forwarding" = 1;

      # Keep Tailscale/resolvconf as the front resolver. This local backend
      # separates public DNS from Freebox DNS without a general ISP fallback.
      services.dnsmasq = {
        enable = true;
        resolveLocalQueries = false;
        settings = {
          listen-address = "127.0.0.1";
          bind-interfaces = true;
          no-resolv = true;
          domain-needed = true;
          bogus-priv = true;
          local = "/local/";
          server = [
            "8.8.8.8"
            "1.1.1.1"
            "/home/fd0f:ee:b0::1@enp34s0"
            "/1.168.192.in-addr.arpa/fd0f:ee:b0::1@enp34s0"
          ];
        };
      };
      # Native profile generation reloads files; reapply their DNS on active
      # connections too, without disconnecting either Ethernet interface.
      systemd.services.NetworkManager-ensure-profiles = {
        requires = [ "dnsmasq.service" ];
        after = [ "dnsmasq.service" ];
        postStart = ''
          ${pkgs.networkmanager}/bin/nmcli connection load \
            "/run/NetworkManager/system-connections/Wired connection 1.nmconnection" \
            "/run/NetworkManager/system-connections/usb-ethernet-no-default.nmconnection"
          if [ "$(${pkgs.networkmanager}/bin/nmcli -g GENERAL.CON-UUID device show enp34s0)" = "63de50e9-fba3-3d28-b023-b76e9ef49350" ]; then
            ${pkgs.networkmanager}/bin/nmcli device reapply enp34s0
          fi
          if [ "$(${pkgs.networkmanager}/bin/nmcli -g GENERAL.CON-UUID device show enp3s0f0u10)" = "91bdad44-9682-3daf-bc17-b4a93cad8136" ]; then
            ${pkgs.networkmanager}/bin/nmcli device reapply enp3s0f0u10
          fi
        '';
      };
      # Refresh Tailscale after the DNS backend and active profiles are ready.
      systemd.services.tailscaled = {
        requires = [ "NetworkManager-ensure-profiles.service" ];
        after = [ "NetworkManager-ensure-profiles.service" ];
        restartTriggers = [
          config.services.dnsmasq.configFile
          config.systemd.units."NetworkManager-ensure-profiles.service".unit
        ];
      };
      # Avahi is already active; let normal applications use its .local names.
      services.avahi.nssmdns4 = true;
      services.avahi.nssmdns6 = true;

      networking.networkmanager.ensureProfiles.profiles."Wired connection 1" = {
        connection = {
          id = "Wired connection 1";
          uuid = "63de50e9-fba3-3d28-b023-b76e9ef49350";
          type = "ethernet";
          interface-name = "enp34s0";
        };
        ipv4 = {
          method = "auto";
          dns = "127.0.0.1;";
          dns-search = "home;";
          ignore-auto-dns = "true";
        };
        ipv6 = {
          method = "auto";
          ignore-auto-dns = "true";
        };
      };

      # Prevent USB ethernet adapter from stealing the default route.
      # The enp3s0f0u10 interface gets an IP via DHCP but has no actual
      # internet gateway, causing IPv4 traffic to black-hole.
      networking.networkmanager.ensureProfiles.profiles."usb-ethernet-no-default" = {
        connection = {
          id = "usb-ethernet-no-default";
          uuid = "91bdad44-9682-3daf-bc17-b4a93cad8136";
          type = "ethernet";
          interface-name = "enp3s0f0u10";
          autoconnect-priority = "100";
        };
        ipv4 = {
          method = "auto";
          ignore-auto-dns = "true";
          never-default = "true";
        };
        ipv6 = {
          method = "auto";
          ignore-auto-dns = "true";
        };
      };
    };
}
