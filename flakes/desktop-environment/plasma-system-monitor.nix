{ ... }:
{
  flake.modules.nixos.plasmaSystemMonitor =
    { lib, pkgs, ... }:
    {
      environment.systemPackages = with pkgs.kdePackages; [
        plasma-systemmonitor
        ksystemstats
        libksysguard
      ];

      # Let the monitor activate its sensor daemon outside a Plasma session.
      systemd.packages = [ pkgs.kdePackages.ksystemstats ];

      # KDE's disk sensors discover storage devices through UDisks2.
      services.udisks2.enable = lib.mkDefault true;

      # Match Plasma's capability-scoped helper for per-process network usage.
      security.wrappers.ksgrd_network_helper = {
        owner = "root";
        group = "root";
        capabilities = "cap_net_raw+ep";
        source = "${pkgs.kdePackages.libksysguard}/libexec/ksysguard/ksgrd_network_helper";
      };
    };
}
