{ inputs, ... }:
let
  # uaccess must be tagged before 73-seat-late.rules assigns the active-seat ACL.
  # extraRules becomes 99-local.rules, which is too late for that builtin.
  rules = inputs.nixpkgs.legacyPackages.x86_64-linux.writeTextDir "lib/udev/rules.d/70-streamdeck.rules" ''
    # Approved Stream Deck + XL only; access follows the active local session.
    SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", ATTRS{idProduct}=="00c6", TAG+="uaccess"
  '';
in
{
  flake.packages.x86_64-linux.frostbit-streamdeck-udev-rules = rules;
  flake.modules.nixos.frostbitStreamDeck = {
    services.udev.packages = [ rules ];
  };
}
