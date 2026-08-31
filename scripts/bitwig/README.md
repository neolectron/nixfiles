# Bitwig generation tooling

This directory contains the version-agnostic analysis and generation tools
used by the Frostbit Nix package override. No extracted Bitwig installation or
pre-generated target JAR is required.

## Layout

```text
scripts/bitwig/
├── analyze_semantic_anchor.py
├── make_renamed_fixture_map.py
└── patches/
    ├── BitwigActivationInitializer.java
    ├── BitwigJarTransformer.java
    ├── BitwigSymbolResolver.java
    ├── deW.java
    └── patch-spec.json
```

- `analyze_semantic_anchor.py` is a read-only CLI that compares the stable
  startup call shape in two JARs and emits JSON.
- `make_renamed_fixture_map.py` creates the adverse, synthetic rename fixture
  used to prove the resolver does not select classes by their old names.
- `patches/BitwigSymbolResolver.java` fingerprints the reviewed reference
  closure and emits the complete target mapping.
- `patches/BitwigJarTransformer.java` validates that mapping and generates a
  new target JAR deterministically.
- `patches/BitwigActivationInitializer.java` and `patches/deW.java` are patch
  payload sources. The latter keeps its obfuscated filename because Java
  requires it to match the reference class it is compiled against.
- `patches/patch-spec.json` names semantic roles only in the reviewed 6.0.6
  reference. It contains no 6.0.11 target symbols.

## Supported entry points

The full download → resolve → generate → install path is declarative:

```bash
nixos-rebuild switch --flake .#frostbit --sudo
```

The read-only startup-anchor CLI can also be run independently:

```bash
nix shell nixpkgs#jdk nixpkgs#python3 --command \
  python scripts/bitwig/analyze_semantic_anchor.py \
  path/to/reference.jar path/to/target.jar
```

Generate the synthetic rename fixture map with:

```bash
python scripts/bitwig/make_renamed_fixture_map.py \
  resolved-identity-map.json fixture-rename-map.json
```

The Java programs are build internals invoked by
`hosts/frostbit/flakes/music-prod.nix`; the Nix derivation supplies their exact
classpath, inputs, and output locations. See
`docs/bitwig-version-agnostic-generation-demo.md` for the algorithm,
validation matrix, hashes, rejection behavior, and installed mapping paths.

## Standalone candidate JARs

A candidate does not need to arrive as a full Linux package for the resolver
and transformer stages. Place a supplied JAR at:

```text
assets/bitwig/candidates/<version>/bitwig.jar
```

Candidate binaries are intentionally ignored by Git. The reviewable,
path-independent outputs can be retained beside them as
`resolved-symbol-map.json` and `result.json`. A full Bitwig delivery is needed
only for the final application launch; byte identity with a generated JAR that
already passed that launch test is independently checkable with SHA-256 or
`cmp`.
