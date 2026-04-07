{ ... }:
{
  # Home Manager side: Kitty terminal emulator
  flake.modules.homeManager.terminal =
    { pkgs, ... }:
    {
      programs.kitty = {
        enable = true;
        settings = {
          font_size = 12;
          enable_audio_bell = false;
          confirm_os_window_close = 0;
          window_padding_width = 4;
        };
      };
    };
}
