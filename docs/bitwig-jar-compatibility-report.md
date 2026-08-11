# Bitwig Studio 6.0.1 JAR artifact diff

## Scope

This document is a bytecode-level comparison of two `bitwig.jar` artifacts:

| Artifact | SHA-256 |
| --- | --- |
| Official Bitwig Studio 6.0.1 JAR | `6afee3c3dbf7ae947d7dd2920a65d4cfc6b5bea102824d79f10d7f3b80a817c2` |
| Modified JAR | `85f184a2478775866474992640f130959524cfc3e1966da0e0922194a542d24d` |

Official build metadata:

```text
Version:     6.0.1
Branch:      releases
Revision:    169441
Revision ID: 250f1f740b9bc5446230ab54339fb8584bf01bf4
```

For a separate, analysis-only cross-version result showing that a startup
anchor can be resolved from 6.0.1 to 6.0.6 despite renamed obfuscated symbols,
see [the semantic-anchor PoC](bitwig-obfuscation-anchor-poc.md).
For the official-source cross-version generation and launch workflow built
from that result, see
[the version-agnostic generation demo](bitwig-version-agnostic-generation-demo.md).

## Comparison result

Both archives contain exactly **30,974 entries**. Their entry names are
identical: no entries were added or removed.

Exactly **six class files** have different content:

| Class | Official SHA-256 | Modified SHA-256 |
| --- | --- | --- |
| `DPH.class` | `52c54eea8fc2be7be64751ccacaa279a3dc2114be4fc0f71cdd05b5dc81db2e1` | `3cefca40f87934d58b1b7903224a45a0eb4d79c3eb4c15f57b440251d8889b4e` |
| `auk.class` | `0189d414d79c1276ff66a7e2caf1dc832fa5824294897f90177bd9e2bfd54b16` | `f986e05bfec459e24d992b95f266142f680db3b0a94d6232b4f4e7abb1334376` |
| `com/bitwig/flt/app/BitwigStudioMain.class` | `b08cb3fb6136052d03a28ba02b092365ad87647cfae2ca967d5fb0695bc0d0ec` | `38a407499e5c3fc656e27a6bae659bb4ee846b691fa0335ba7d2bfaf90de0b32` |
| `com/bitwig/flt/document/core/master/izl.class` | `f0930d8d7639e937f84eba7f223ea7e51bb25961630e20f01e41374f5b5830fb` | `42b24a9350bb36720ede2a42cb4edadbd98834b6c9bc62fa13f0a79715c19592` |
| `dcQ.class` | `23084e9cb7d4fe9af87769eab65ec2800ee6e3d7547a4167a6722503460b35ba` | `eef130bc0d3d0adb44b44312bf9136ea4577062ab55f119bc7342ac461b5b668` |
| `dcW.class` | `2fc3d69855b554689546bd39647a392069bece2c59894900f05f93a378d45f60` | `b2d0578cce1f25b1dba1c15edcc22d54822338efee7bc154a055e7568e5ebe2b` |

All other 30,968 class and resource entries are byte-identical.

## Observable class-level changes

The application is obfuscated, so the class names below are preserved exactly
as found. The statements in this section are limited to behavior visible in
the disassembled bytecode.

### `com.bitwig.flt.app.BitwigStudioMain`

- Adds one private method: `createActivationFile()`.
- That method resolves the platform-specific Bitwig settings directory,
  ensures it exists, and creates `.activation-11` containing `user` if the
  file is absent.
- Changes two static calls on `okU`:

  | Official class | Modified class |
  | --- | --- |
  | `okU.JVX(): okU` | `okU.prq(): okU` |
  | `okU.l_(): boolean` | `okU.PqD(): boolean` |

### `dcQ`

- The official `Kvz()` method constructs and caches a `dcV` descriptor named
  `Bitwig Studio Trial`, copying fields and feature flags from descriptor key
  `11`.
- The modified `Kvz()` method returns `null` immediately.

### `dcW`

- The official class has a `java.security.PublicKey` field and methods for
  reading, decoding, and deserializing `dcV` data.
- The modified class removes those members and exposes a static `dcV yay`
  field instead.

### `auk`

- The class retains the visible `license_info` UI item but removes its
  registered `Runnable` action.
- It also removes the `Runnable` action registered for the `Exit Demo Mode`
  item.

### `DPH` and `com.bitwig.flt.document.core.master.izl`

- Their public method signatures are unchanged.
- Official `DPH.zE(WsP): boolean` first requires `WsP.hjk()` and then checks
  whether `WsP.zE(): int` occurs in the class's `eoF` integer array. The
  modified method consists only of `iconst_1; ireturn`.
- The 6.0.6 structural counterpart is `mvZ.ffA(l2U): boolean`. Its interface
  and call-site shapes match, and its stock body performs the corresponding
  boolean and integer-array membership checks. This mapping was confirmed by
  disassembly and included in the 6.0.6 generator.
- `com.bitwig.flt.document.core.master.izl` also differs, but its observed
  changes have not been shown to participate in activation and are not copied
  into the 6.0.6 result.

## Analysis methodology

No hex editor was used. A JAR is a ZIP archive and a `.class` file is JVM
bytecode. The analysis used the following four stages:

1. **Archive extraction** — `7z` extracted each JAR to a separate directory.
2. **Entry comparison** — `diff -qr` compared the extracted directory trees to
   identify added, removed, and changed entries.
3. **Artifact hashing** — `sha256sum` recorded the hashes of both whole JARs
   and every changed class file.
4. **Bytecode inspection** — the JDK's `javap` read each changed class:
   `javap -p` lists fields and methods, while `javap -p -c` disassembles the
   JVM instructions. Unified diffs of those outputs identified the behavioral
   changes documented above.

The procedure can be reproduced as follows:

```bash
# JARs are ZIP archives.
7z x official-bitwig.jar -oofficial
7z x modified-bitwig.jar -omodified

# Confirm entry-level changes.
diff -qr official modified

# Hash the artifacts and each changed class.
sha256sum official-bitwig.jar modified-bitwig.jar
sha256sum official/dcQ.class modified/dcQ.class

# Inspect a class API and disassemble its JVM bytecode.
javap -p -classpath official com.bitwig.flt.app.BitwigStudioMain
javap -p -c -classpath official com.bitwig.flt.app.BitwigStudioMain

# Produce a readable instruction-level diff for one changed class.
javap -p -c -classpath official dcQ > official-dcQ.javap
javap -p -c -classpath modified dcQ > modified-dcQ.javap
diff -u official-dcQ.javap modified-dcQ.javap
```

`javap` is a disassembler, not a source decompiler: its output preserves class,
field, and method names as they exist in the bytecode and prints JVM
instructions. A Java decompiler such as CFR, Fernflower, or Bytecode Viewer
can provide a source-like view, but cannot recover the original semantic
identifiers from the obfuscated classes.
