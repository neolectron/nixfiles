{ ... }:
{
  # Home Manager side: Kitty terminal emulator
  flake.modules.homeManager.terminal =
    { lib, ... }:
    {
      programs.kitty = {
        enable = true;
        settings = {
          font_size = lib.mkDefault 12;
          enable_audio_bell = lib.mkDefault false;
          confirm_os_window_close = lib.mkDefault 0;
          window_padding_width = lib.mkDefault 4;
        };
      };
    };
}
