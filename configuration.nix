# Edit this configuration file to define what should be installed on
# your system.  Help is available in the configuration.nix(5) man page
# and in the NixOS manual (accessible by running ‘nixos-help’).

{
  config,
  pkgs,
  lib,
  ...
}:

{
  imports = [
    # Include the results of the hardware scan.
    ./hardware-configuration.nix
  ];

  # Bootloader.
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # Use latest kernel.
  boot.kernelPackages = pkgs.linuxPackages_latest;

  networking.hostName = "nixos"; # Define your hostname.
  # networking.wireless.enable = true;  # Enables wireless support via wpa_supplicant.

  # Configure network proxy if necessary
  # networking.proxy.default = "http://user:password@proxy:port/";
  # networking.proxy.noProxy = "127.0.0.1,localhost,internal.domain";

  # Enable networking
  networking.networkmanager.enable = true;

  # Set your time zone.
  time.timeZone = "Europe/Paris";

  # Select internationalisation properties.
  i18n.defaultLocale = "en_US.UTF-8";

  i18n.extraLocaleSettings = {
    LC_ADDRESS = "fr_FR.UTF-8";
    LC_IDENTIFICATION = "fr_FR.UTF-8";
    LC_MEASUREMENT = "fr_FR.UTF-8";
    LC_MONETARY = "fr_FR.UTF-8";
    LC_NAME = "fr_FR.UTF-8";
    LC_NUMERIC = "fr_FR.UTF-8";
    LC_PAPER = "fr_FR.UTF-8";
    LC_TELEPHONE = "fr_FR.UTF-8";
    LC_TIME = "fr_FR.UTF-8";
  };

  # Enable the X11 windowing system.
  # You can disable this if you're only using the Wayland session.
  services.xserver.enable = true;

  # Enable the KDE Plasma Desktop Environment.
  services.displayManager.sddm.enable = true;
  services.desktopManager.plasma6.enable = true;

  # Configure keymap in X11
  services.xserver.xkb = {
    layout = "us";
    variant = "";
  };

  # Enable CUPS to print documents.
  services.printing.enable = true;

  # Enable sound with pipewire.
  services.pulseaudio.enable = false;
  security.rtkit.enable = true;
  services.pipewire = {
    enable = true;
    audio.enable = true;
    alsa.enable = true;
    alsa.support32Bit = true;
    pulse.enable = true;
    wireplumber.enable = true;
    jack.enable = false;

    # Behringer UMC1820 loopback config is in environment.etc below
    # (PipeWire SPA JSON needs dotted keys which Nix JSON serialization can't produce)
  };

  # Behringer UMC1820 - virtual microphones via PipeWire loopback modules.
  #
  # WHY: The UMC1820 exposes a single 18-channel ALSA device. Apps like Discord
  # only understand simple mono/stereo sources, so the raw multichannel device
  # is either invisible or unusable to them. We use libpipewire-module-loopback
  # to extract individual AUX channels into standalone Audio/Source nodes that
  # appear as normal microphones in PulseAudio-compatible apps.
  #
  # HOW IT WORKS:
  #   - capture.props targets the UMC1820 multichannel ALSA node
  #   - audio.position = [ AUX<n> ] selects which channel to grab
  #   - stream.dont-remix = true prevents PipeWire from remixing channels
  #     (without this, it connects AUX0/AUX1 instead of the requested channel)
  #   - playback.props with media.class = "Audio/Source" registers a real source
  #     device visible to PulseAudio/PipeWire clients (Discord, OBS, etc.)
  #     NOTE: "Stream/Source/Virtual" does NOT show up in Discord -- must use "Audio/Source"
  #   - audio.position = [ MONO ] on playback outputs a single mono channel
  #   - node.passive = true on capture avoids forcing the UMC1820 to stay active
  #
  # NIX GOTCHA: We use services.pipewire.configPackages with pkgs.writeTextDir
  # instead of services.pipewire.extraConfig because PipeWire's SPA JSON uses
  # dotted keys (e.g. node.name, audio.position) which Nix's attrset-to-JSON
  # serialization incorrectly nests as { node = { name = ... } }.
  # NixOS 25.11 also blocks direct environment.etc."pipewire/..." writes.
  #
  # ALSA NODE NAME: The target.object value includes the device serial number.
  # Find yours with: pw-cli list-objects | grep -A2 BEHRINGER
  # Current: alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input
  #
  # DEBUGGING:
  #   pw-cli list-objects | grep -i "loopback\|Audio/Source\|UMC"  -- check if loopback loaded
  #   journalctl --user -u pipewire -n 50    -- PipeWire startup errors
  #   journalctl --user -u wireplumber -n 50 -- WirePlumber linking errors
  #   helvum                                 -- visual audio routing (patchbay)
  #   pavucontrol                            -- volume levels & device selection
  #   After nixos-rebuild switch, restart user services:
  #     systemctl --user restart pipewire pipewire-pulse wireplumber
  #
  # REFERENCE: PipeWire loopback module docs with examples (Scarlett Focusrite, Behringer UMC404HD):
  #   https://man.archlinux.org/man/libpipewire-module-loopback.7.en
  #
  # Currently only AUX2 is enabled (main mic input).
  # To add more channels, duplicate the loopback block and change AUX2 to AUX0-AUX11.
  services.pipewire.configPackages = [
    (pkgs.writeTextDir "share/pipewire/pipewire.conf.d/umc1820-loopback.conf" ''
      context.modules = [
        {
          name = libpipewire-module-loopback
          args = {
            node.description = "UMC1820 Mic (AUX2)"
            capture.props = {
              node.name         = capture.UMC1820_AUX2
              audio.position    = [ AUX2 ]
              stream.dont-remix = true
              target.object     = "alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input"
              node.passive      = true
            }
            playback.props = {
              node.name         = UMC1820_Mic_AUX2
              media.class       = "Audio/Source"
              audio.position    = [ MONO ]
            }
          }
        }
        # To enable more channels, duplicate the block above and change AUX2.
        # Example for AUX0:
        # {
        #   name = libpipewire-module-loopback
        #   args = {
        #     node.description = "UMC1820 Mic (AUX0)"
        #     capture.props = {
        #       node.name         = capture.UMC1820_AUX0
        #       audio.position    = [ AUX0 ]
        #       stream.dont-remix = true
        #       target.object     = "alsa_input.usb-BEHRINGER_UMC1820_BAB9273B-00.multichannel-input"
        #       node.passive      = true
        #     }
        #     playback.props = {
        #       node.name         = UMC1820_Mic_AUX0
        #       media.class       = "Audio/Source"
        #       audio.position    = [ MONO ]
        #     }
        #   }
        # }
      ]
    '')
  ];

  # Enable touchpad support (enabled default in most desktopManager).
  # services.xserver.libinput.enable = true;

  # Define a user account. Don't forget to set a password with ‘passwd’.
  users.users.neolectron = {
    isNormalUser = true;
    description = "neolectron";
    extraGroups = [
      "networkmanager"
      "wheel"
      "docker"
    ];
    packages = with pkgs; [
      kdePackages.kate
      discord
      neovim
      google-chrome
      bitwarden-desktop
      opencode
      vscode
      git
      curl
      jq
      ripgrep
      gh
      nixfmt
      uv
      kitty
      helvum # PipeWire patchbay (audio routing GUI)
      pavucontrol # PulseAudio volume control
      spotify
    ];
  };

  # Allow unfree packages
  nixpkgs.config.allowUnfree = true;

  # List packages installed in system profile. To search, run:
  # $ nix search wget
  environment.systemPackages = with pkgs; [
    #  vim # Do not forget to add an editor to edit configuration.nix! The Nano editor is also installed by default.
    #  wget
  ];

  # Enable nix-ld to run dynamically linked binaries (e.g. uvx-managed Python)
  programs.nix-ld.enable = true;

  # Some programs need SUID wrappers, can be configured further or are
  # started in user sessions.
  # programs.mtr.enable = true;
  # programs.gnupg.agent = {
  #   enable = true;
  #   enableSSHSupport = true;
  # };

  # List services that you want to enable:

  # Enable the OpenSSH daemon.
  # services.openssh.enable = true;

  # Open ports in the firewall.
  # networking.firewall.allowedTCPPorts = [ ... ];
  # networking.firewall.allowedUDPPorts = [ ... ];
  # Or disable the firewall altogether.
  # networking.firewall.enable = false;

  # This value determines the NixOS release from which the default
  # settings for stateful data, like file locations and database versions
  # on your system were taken. It‘s perfectly fine and recommended to leave
  # this value at the release version of the first install of this system.
  # Before changing this value read the documentation for this option
  # (e.g. man configuration.nix or on https://nixos.org/nixos/options.html).
  system.stateVersion = "25.11"; # Did you read the comment?

}
