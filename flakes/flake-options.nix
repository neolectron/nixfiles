{ lib, ... }:
{
  options.flake.username = lib.mkOption {
    type = lib.types.str;
    default = "your-username";
    description = "Primary username shared across all modules";
  };
}
