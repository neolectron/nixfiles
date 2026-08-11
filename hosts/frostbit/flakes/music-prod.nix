{ ... }:
{
  flake.modules.homeManager.musicProd =
    { pkgs, ... }:
    let
      bitwig-6-0-1-deb = pkgs.fetchurl {
        name = "bitwig-studio-6.0.1.deb";
        url = "https://www.bitwig.com/dl/Bitwig%20Studio/6.0.1/installer_linux";
        hash = "sha256-RuDDcBeiAI+QctLBhmRBtEbEVTwn3zACx6WAsRmsIBo=";
      };
      bitwig-6-0-6-deb = pkgs.fetchurl {
        name = "bitwig-studio-6.0.6-reference.deb";
        url = "https://www.bitwig.com/dl/Bitwig%20Studio/6.0.6/installer_linux";
        hash = "sha256-tczgtA4v3a5Qjxaa6ZvaiFDWD6dhRw19vj8IMxkyCNI=";
      };
      bitwig-6-0-11-deb = pkgs.fetchurl {
        name = "bitwig-studio-6.0.11.deb";
        url = "https://www.bitwig.com/dl/Bitwig%20Studio/6.0.11/installer_linux";
        hash = "sha256-rnr/Z8y6klKrU2gT5/XT+sRryl/HZZZ04n565L0HPEw=";
      };
      asm = pkgs.fetchurl {
        name = "asm-9.10.1.jar";
        url = "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar";
        hash = "sha256-7YJdEKsTmcjAy2aeaIzwyMgmKbTIOZtYNSto6SyhD8s=";
      };
      bitwig-studio-generated =
        pkgs.bitwig-studio.overrideAttrs (oldAttrs: {
          version = "6.0.11";
          src = bitwig-6-0-11-deb;

          nativeBuildInputs = (oldAttrs.nativeBuildInputs or [ ]) ++ [
            pkgs.dpkg
            pkgs.jdk
            pkgs.python3
          ];

          # Analyze the untouched 6.0.11 target against two hash-pinned official
          # references. 6.0.1 preserves the original research comparison;
          # 6.0.6 supplies the reviewed patch semantics whose obfuscated
          # symbols are structurally resolved against the downloaded target.
          postInstall = (oldAttrs.postInstall or "") + ''
            reference601="$TMPDIR/bitwig-6.0.1"
            reference606="$TMPDIR/bitwig-6.0.6"
            ${pkgs.dpkg}/bin/dpkg-deb --extract ${bitwig-6-0-1-deb} "$reference601"
            ${pkgs.dpkg}/bin/dpkg-deb --extract ${bitwig-6-0-6-deb} "$reference606"

            ${pkgs.python3}/bin/python ${../../../scripts/bitwig/analyze_semantic_anchor.py} \
              "$reference601/opt/bitwig-studio/bin/bitwig.jar" \
              "$out/libexec/bin/bitwig.jar" \
              > "$TMPDIR/bitwig-semantic-anchor-map.json"

            classes="$TMPDIR/bitwig-transformer-classes"
            mkdir -p "$classes"
            cp ${../../../scripts/bitwig/patches/BitwigActivationInitializer.java} "$TMPDIR/BitwigActivationInitializer.java"
            cp ${../../../scripts/bitwig/patches/BitwigJarTransformer.java} "$TMPDIR/BitwigJarTransformer.java"
            cp ${../../../scripts/bitwig/patches/BitwigSymbolResolver.java} "$TMPDIR/BitwigSymbolResolver.java"
            cp ${../../../scripts/bitwig/patches/patch-spec.json} "$TMPDIR/patch-spec.json"
            cp ${../../../scripts/bitwig/patches/deW.java} "$TMPDIR/deW.java"
            ${pkgs.jdk}/bin/javac --release 17 -d "$classes" \
              "$TMPDIR/BitwigActivationInitializer.java"
            ${pkgs.jdk}/bin/javac -cp ${asm} -d "$classes" \
              "$TMPDIR/BitwigJarTransformer.java" \
              "$TMPDIR/BitwigSymbolResolver.java"
            ${pkgs.jdk}/bin/javac --release 17 \
              -cp "$reference606/opt/bitwig-studio/bin/bitwig.jar" \
              -d "$classes" \
              "$TMPDIR/deW.java"
            ${pkgs.jdk}/bin/java -cp "$classes:${asm}" BitwigSymbolResolver \
              "$TMPDIR/patch-spec.json" \
              "$reference606/opt/bitwig-studio/bin/bitwig.jar" \
              "$out/libexec/bin/bitwig.jar" \
              "$TMPDIR/bitwig-resolved-symbol-map.json"
            ${pkgs.jdk}/bin/java -cp "$classes:${asm}" BitwigJarTransformer \
              "$out/libexec/bin/bitwig.jar" \
              "$TMPDIR/bitwig-target-generated.jar" \
              "$classes/com/bitwig/flt/app/BitwigActivationInitializer.class" \
              "$classes/deW.class" \
              "$TMPDIR/bitwig-resolved-symbol-map.json"

            install -Dm644 "$TMPDIR/bitwig-target-generated.jar" "$out/libexec/bin/bitwig.jar"
            install -Dm644 "$TMPDIR/bitwig-semantic-anchor-map.json" \
              "$out/share/bitwig/semantic-anchor-map.json"
            install -Dm644 "$TMPDIR/bitwig-resolved-symbol-map.json" \
              "$out/share/bitwig/resolved-symbol-map.json"
          '';
        });
    in
    {
      home.packages = [
        # DAW
        bitwig-studio-generated
        pkgs.reaper

        # Windows VST2/VST3 bridge
        pkgs.yabridge
        pkgs.yabridgectl
      ];
    };
}
