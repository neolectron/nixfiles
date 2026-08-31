# Standalone Bitwig candidates

This directory records tests against JARs supplied independently of the Nix
package download. Put each untouched candidate at:

```text
<version>/bitwig.jar
```

The upstream JAR and machine-specific `semantic-anchor-map.json` are ignored
by Git. Commit only path-independent evidence:

- `resolved-symbol-map.json` — the complete resolver output;
- `result.json` — input, reference, mapping, and generated-output hashes.

The 6.0.11 candidate was supplied by the hackathon judges on 2026-08-18. Its
hash exactly matches the official 6.0.11 target already used by the Nix demo.
