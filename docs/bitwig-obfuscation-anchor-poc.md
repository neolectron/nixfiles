# Obfuscation-resilient startup-anchor PoC: Bitwig 6.0.1 → 6.0.6

## Objective

Test whether a startup dependency can be resolved across Bitwig versions using
bytecode structure rather than obfuscated class or method names.

This is an analysis-only proof of concept. It reads JARs and emits a mapping;
it does not modify JARs or generate a binary patch.

The corresponding cross-version generation and launch workflow is documented
in [the version-agnostic generation demo](bitwig-version-agnostic-generation-demo.md).
That production demonstration now includes a separate full symbol-closure
resolver; this document remains focused on the original startup anchor.

## Inputs

| Input | Version / revision | JAR SHA-256 |
| --- | --- | --- |
| Reference JAR | 6.0.1 / `250f1f740b9bc5446230ab54339fb8584bf01bf4` | `6afee3c3dbf7ae947d7dd2920a65d4cfc6b5bea102824d79f10d7f3b80a817c2` |
| Target JAR | 6.0.6 / `9244933ec29bf8a78484df80647f9686b64960e1` | `60900e12204de26e2973011122ca375eaacc94268cb0f9a848de7a0f421bc32b` |

## Name-independent anchor

The analyzer starts from the non-obfuscated entrypoint
`com.bitwig.flt.app.BitwigStudioMain` and looks for all of the following:

1. a static, no-argument accessor that returns an object of its declaring type;
2. an immediately following, no-argument virtual method on that object that
   returns `String`;
3. another call to the same accessor followed by a no-argument virtual method
   returning `boolean`.

The selector uses JVM descriptors and instruction adjacency only. It does not
contain `okU`, `Qkb`, `JVX`, `nrP`, `zE`, or `ffA` as matching inputs.

## Result

One high-confidence candidate was found in each JAR:

| Property | Bitwig 6.0.1 | Bitwig 6.0.6 |
| --- | --- | --- |
| Owner class | `okU` | `Qkb` |
| Static accessor | `JVX(): okU` | `nrP(): Qkb` |
| String-returning instance method | `zE(): String` | `ffA(): String` |
| Boolean-returning instance method | `l_(): boolean` | `l_(): boolean` |
| Startup accessor call offset | 393 | 393 |
| Analyzer confidence | high | high |

This demonstrates that the selected behavior remains structurally identifiable
even though both the owner class and static accessor names changed between
official releases. Notably, `okU.class` is absent from the 6.0.6 JAR.

## Reproduce

The analyzer is
[analyze_semantic_anchor.py](../scripts/bitwig/analyze_semantic_anchor.py).
It requires a JDK (`javap`) and Python 3:

```bash
nix shell nixpkgs#jdk nixpkgs#python3 --command \
  python scripts/bitwig/analyze_semantic_anchor.py \
  path/to/bitwig-6.0.1.jar \
  path/to/bitwig-6.0.6.jar
```

Expected output is JSON containing one anchor per JAR and:

```json
{
  "semantic_anchor_count_matches": true,
  "interpretation": "A single high-confidence startup anchor was found in each JAR. Its names may differ, but its call shape is the same."
}
```

## What this proves

- Obfuscated names are not necessary to identify this specific startup anchor.
- A selector based on descriptors, call shape, and repeated use can resolve a
  cross-version mapping that a name-based comparison misses.
- The approach produces a reviewable result: the resolved names, offsets,
  descriptors, JAR hashes, and confidence are all emitted.

## Full patch-closure extension

`patches/BitwigSymbolResolver.java` extends the same principle beyond the
startup entrypoint. It reads the version-specific semantic roles from
`patches/patch-spec.json`, computes name-independent fingerprints for eight
reference classes, and emits `resolved-symbol-map.json` for the downloaded
target. `patches/BitwigJarTransformer.java` consumes that generated file
rather than containing target class or method names.

A synthetic target renamed all eight classes and every one of their declared
fields and methods. The resolver recovered the new names without a spec
change; the transformed result launched Bitwig and started its audio engine.
See the generation demo for the exact mapping and rejection boundary.

## What this does not prove

- It does not prove semantic equivalence of every method in either JAR.
- It does not prove that every future Bitwig release has an equivalent anchor.
- It does not prove that any binary transformation is safe across versions.
- The startup analyzer itself is one anchor over two official versions. The
  separate patch-closure resolver covers the reviewed transformation but is
  still not a general deobfuscator.

## Next validation steps

1. Run the analyzer over a larger matrix of official Bitwig releases.
2. Add independent anchors from other stable entrypoints and measure agreement
   between their inferred mappings.
3. Normalize control-flow graphs and call-graph neighborhoods, then compare
   those fingerprints alongside the current descriptor-based selector.
4. Define conservative rejection rules: ambiguous candidates, changed method
   descriptors, or divergent control flow must report `unsupported` rather
   than infer a mapping.
5. Add a test corpus of known mappings and intentionally incompatible builds so
   precision and rejection behavior can be measured quantitatively.
