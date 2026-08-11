# Version-agnostic, symbol-resilient Bitwig generation demo

## Goal

Build Bitwig Studio from an official upstream delivery, derive a reviewable
mapping against hash-pinned references, generate the target `bitwig.jar`, and
launch it without a manual replacement step. The target version is a delivery
input rather than a set of names embedded in the patch: a release whose
obfuscated symbols changed but whose relevant bytecode structure did not is
resolved automatically.

The checked-in 6.0.1 JAR is not an input to this package build and is left
unchanged. No pre-extracted Bitwig application tree is referenced: Nix fetches
every build input directly from its declared upstream URL.

## Pinned inputs

| Purpose | Source | Integrity check |
| --- | --- | --- |
| Comparison reference | Bitwig's official 6.0.1 Linux installer | `sha256-RuDDcBeiAI+QctLBhmRBtEbEVTwn3zACx6WAsRmsIBo=` |
| Patch-semantics reference | Bitwig's official 6.0.6 Linux installer | `sha256-tczgtA4v3a5Qjxaa6ZvaiFDWD6dhRw19vj8IMxkyCNI=` |
| Current target | Bitwig's official 6.0.11 Linux installer, applied as a source override to the locked nixpkgs package | `sha256-rnr/Z8y6klKrU2gT5/XT+sRryl/HZZZ04n565L0HPEw=`; untouched JAR SHA-256 `3971ce118701ed3a60603ae5cec134b52dcaf88178c0e1d1a6b040be85acf229` |
| Bytecode library | ASM 9.10.1 from Maven Central | `sha256-7YJdEKsTmcjAy2aeaIzwyMgmKbTIOZtYNSto6SyhD8s=` |

The conference configuration explicitly pins the target download to 6.0.11,
so updating the rest of the locked nixpkgs input cannot silently change the
demo target. The resolver still discovers its symbols from the downloaded JAR;
there are no 6.0.11 obfuscated names in the patch specification. A
structurally changed, ambiguous, or incompatible target fails without
producing a generated JAR.

## Version model

The workflow separates three concerns that are easy to conflate:

| Concern | Current value | How it changes |
| --- | --- | --- |
| Historical comparison | 6.0.1 | Fixed evidence; not used as target bytecode |
| Reviewed patch semantics | 6.0.6 | Fixed reference names and class closure in `scripts/bitwig/patches/patch-spec.json` |
| Downloaded target | 6.0.11 | Nix version, URL, and fixed-output hash only |

Moving to a symbol-only-compatible target therefore changes the delivery pin,
not the Java sources or JSON specification. The generated
`resolved-symbol-map.json` is the auditable bridge between the reviewed 6.0.6
roles and that target. Meaningful structural changes are rejected rather than
guessed.

## Build pipeline

`hosts/frostbit/flakes/music-prod.nix` performs this work in the package build:

1. The normal nixpkgs Bitwig derivation is source-overridden with Bitwig's
   hash-pinned official 6.0.11 delivery.
2. Nix fetches and extracts official 6.0.1 and 6.0.6 reference installers.
3. `scripts/bitwig/analyze_semantic_anchor.py` compares the two untouched JARs
   and writes `semantic-anchor-map.json` into the resulting package.
4. `scripts/bitwig/patches/BitwigSymbolResolver.java` reads
   `scripts/bitwig/patches/patch-spec.json`, fingerprints the complete
   eight-class reference closure, and searches the untouched target for
   exactly one structural counterpart per class. It emits
   `resolved-symbol-map.json`, including every remapped field, method,
   descriptor, role, and both JAR hashes.
5. `scripts/bitwig/patches/BitwigJarTransformer.java` verifies that the
   mapping's target hash equals the input JAR hash. It consumes the resolved
   names, remaps the parser replacement bytecode, and independently resolves
   the startup anchor.
6. Only after those checks succeed, the generator writes a new target JAR. It
   adds the startup helper class
   `com.bitwig.flt.app.BitwigActivationInitializer`, replaces the mapped
   parser class with source compiled against the fixed 6.0.6 reference,
   replaces one mapped trial-descriptor method, and replaces the mapped
   local-license eligibility predicate. It never mutates the downloaded JAR
   in place or copies a 6.0.1 class into the output.

The mapping is name-independent when selecting the anchor: it requires a
static no-argument accessor returning its declaring type, followed by a
no-argument `String` call, with another use of that accessor followed by a
no-argument boolean call. For the two releases the emitted mapping is:

| Field | 6.0.1 | 6.0.6 |
| --- | --- | --- |
| Owner | `okU` | `Qkb` |
| Static accessor | `JVX` | `nrP` |
| String method | `zE` | `ffA` |
| Boolean method | `l_` | `l_` |
| Call offset | 393 | 393 |

The patch specification gives semantic roles names only in the reviewed 6.0.6
reference. The resolver supplies the target side at build time:

| 6.0.1 behavior | 6.0.6 target | Validation basis |
| --- | --- | --- |
| `dcW.zE(byte[])` fixture parser | `deW.ffA(byte[])` | identical Ed25519 error marker, method descriptor, and license-model constructor shape |
| `dcQ.Kvz(): dcV` trial descriptor | `deR.kG(): deV` | identical "Bitwig Studio Trial" construction and accessor sequence |
| `DPH.zE(WsP): boolean` eligibility predicate | `mvZ.ffA(l2U): boolean` | matching five-method interface shape, integer-array membership test, and equivalent call-site neighborhoods |

`scripts/bitwig/patches/deW.java` is compiled against the official 6.0.6 JAR
and fills the additional target-model fields which the 6.0.6 activation UI
dereferences. The transformer changes `deR.kG()` to return `null`, matching the
corresponding 6.0.1 modified method. It also changes `mvZ.ffA(l2U)` to return
`true`, matching the two-instruction body of the modified 6.0.1
`DPH.zE(WsP)` method. The transformer requires exactly one method with that
owner/name/descriptor and fails without producing a JAR otherwise.

## Structural fingerprint

The resolver intentionally excludes obfuscated class, field, and method names
from its class fingerprint. It retains:

- class, field, and method access/type shapes;
- declaration order and member counts;
- normalized JVM opcode streams;
- string and numeric constants;
- control-flow instruction sequence;
- self-field and self-method reference indexes;
- stable JDK owner/member names.

Every reference class must resolve to exactly one target class with an
identical fingerprint. Members are then mapped by their validated declaration
position, descriptor shape, and normalized method body. This is designed for
symbol-only re-obfuscation and deliberately rejects meaningful structural
changes.

## Reproduce the conference demo

From this repository, build and activate the host configuration:

```bash
nixos-rebuild switch --flake .#frostbit --sudo
```

This builds the generated 6.0.11 JAR and installs `bitwig-studio` normally.
Launch it from the usual desktop entry or run:

```bash
bitwig-studio
```

The installed package contains both reviewable artifacts:

```text
<Bitwig package output>/share/bitwig/semantic-anchor-map.json
<Bitwig package output>/share/bitwig/resolved-symbol-map.json
```

The complete Frostbit configuration was switched successfully. The active
command and desktop entry both resolve to the generated package
`bitwig-studio6-6.0.11`; launching that desktop entry was visually confirmed
to open and operate normally on the presentation system.

Locate them from the active desktop package without hardcoding a Nix store
path:

```bash
bitwig_pkg="$(dirname "$(dirname "$(readlink -f "$(command -v bitwig-studio)")")")"
less "$bitwig_pkg/share/bitwig/resolved-symbol-map.json"
```

To demonstrate the mapping independently of Nix, with two official JARs:

```bash
nix shell nixpkgs#jdk nixpkgs#python3 --command \
  python scripts/bitwig/analyze_semantic_anchor.py \
  path/to/bitwig-6.0.1.jar path/to/bitwig-6.0.6.jar
```

## Validation matrix

The same production resolver and transformer were validated at three levels:

| Target | Purpose | Result |
| --- | --- | --- |
| Official 6.0.6 | Baseline against the reviewed semantic reference | Generated package launched |
| Synthetic fully renamed 6.0.6 | Adverse symbol-only fixture | Mapping recovered and generated package launched |
| Official 6.0.11 | Real later release with changed obfuscated mapping | Generated system package launched from its desktop entry |

### Official 6.0.6 baseline

The final build produced a generated 6.0.6 JAR with SHA-256:

```text
e3b3a14a5b27e903c28f87b3a81f86e30ed303a8e2db42a97da25a6e00dd0c9a
```

An isolated 6.0.6 launch was run with a temporary `user.home`. The helper
created `.BitwigStudio/.activation-11` with exactly these bytes:

```text
75 73 65 72    ("user")
```

Bitwig completed startup under the exact package referenced by the generated
Home Manager profile, displayed its normal project window, and started the
audio engine. The 6.0.6 runtime still attempted an asynchronous server refresh
of the synthetic local token and logged `deI: Incorrect token`; that refresh
did not prevent the locally accepted state or normal application startup. This
distinction is visible in the test log and is intentionally not hidden from the
demo result. The test verifies the complete download → analysis/mapping →
generation → launch path while retaining the official 6.0.1 JAR as an
untouched reference.

### Synthetic symbol-only release

The test fixture renames all eight resolved classes and every declared field
and method, then rewrites their references across the entire official JAR.
Examples from the test are:

| Reference | Synthetic target |
| --- | --- |
| `deW.ffA(byte[])` | `CodexFixtureA.m1(byte[])` |
| `deR.kG()` | `CodexFixtureB.m8()` |
| `mvZ.ffA(l2U)` | `CodexFixtureH.m2f(l2U)` |

The production resolver was run against that renamed JAR without changing the
patch specification. It independently emitted those target names, the
transformer remapped the compiled parser and applied both method-body changes,
and the resulting JAR opened Bitwig's normal project window and started the
audio engine in an isolated home. This validates class, field, method,
descriptor, stack-frame, and array-owner remapping—not only JSON generation.

The test-only rename map is produced with:

```bash
python scripts/bitwig/make_renamed_fixture_map.py \
  resolved-identity-map.json fixture-rename-map.json
```

`BitwigJarTransformer --remap-fixture` applies that synthetic rename map. This
mode exists only to construct an adverse test input; the production path never
renames the upstream JAR before analysis.

### Real Bitwig 6.0.11 release

The same unchanged patch specification was then tested against Bitwig Studio
6.0.11, a real later release published by Bitwig and packaged by nixpkgs
master. No 6.0.11 target names were added to the source code or specification.

| Artifact | Value |
| --- | --- |
| Official DEB fixed-output hash | `sha256-rnr/Z8y6klKrU2gT5/XT+sRryl/HZZZ04n565L0HPEw=` |
| Untouched 6.0.11 JAR SHA-256 | `3971ce118701ed3a60603ae5cec134b52dcaf88178c0e1d1a6b040be85acf229` |
| Generated 6.0.11 JAR SHA-256 | `b71be9c1f8d733ae3869a68447188b3499dae1700e7fca6115a5c035d0d59946` |
| nixpkgs test revision | `d01a8973e4bb2d12ee6e89a96e0bc9be484f8c39` |
| Bitwig runtime revision | `f2730b10e641fdf2e4ae82140089d5f6550ca3b7` |

The resolver produced this class map from the downloaded JARs:

| 6.0.6 semantic reference | 6.0.11 target |
| --- | --- |
| `deW` | `ddR` |
| `deR` | `ddL` |
| `deV` | `ddQ` |
| `deT` | `ddN` |
| `deU` | `ddP` |
| `dfc` | `ddY` |
| `dfd` | `ddZ` |
| `mvZ` | `ytr` |

The resolved transformation roles were:

| Role | 6.0.11 method |
| --- | --- |
| Activation parser | `ddR.FhI(byte[]): ddL` |
| Trial descriptor | `ddL.yos(): ddQ` |
| Local eligibility | `ytr.FhI(Yu2): boolean` |

The generated JAR was overlaid onto nixpkgs' untouched 6.0.11 package in an
isolated home. The log identified application version 6.0.11, the normal
project window opened, and the audio engine started project `New 1`. The
window was also visually confirmed to work. As in 6.0.6, an asynchronous
refresh logged `Incorrect token` but did not prevent local acceptance or
normal startup.

This real-release result is stronger than the synthetic fixture: it shows that
the normalized fingerprints survived Bitwig's actual 6.0.6-to-6.0.11 symbol
map and that the generated bytecode remained executable in the later package.

## Scope and rejection behavior

This is an obfuscation-resilient mapper for the explicitly reviewed patch
closure, not a general deobfuscator. It supports changed symbols when the
relevant declaration order, descriptors, constants, and normalized bytecode
remain equivalent. A meaningful implementation change, member reordering,
missing/ambiguous fingerprint, changed reference hash, stale target map, or
missing startup anchor is reported as unsupported and no output JAR is
accepted. That fail-closed boundary is part of the result.
