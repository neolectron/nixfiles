{ lib, ... }:
{
  config.systems = [ "x86_64-linux" ];

  # username
  options.flake.username = lib.mkOption {
    type = lib.types.str;
    default = "user";
    description = "Primary username shared across all modules";
  };
  config.flake.username = "neolectron";

  # user email (for git)
  options.flake.userEmail = lib.mkOption {
    type = lib.types.str;
    default = "noreply@acme.com";
    description = "Primary user email shared across all modules";
  };
  config.flake.userEmail = "neolectron@codinglab.io";

  #  
}
