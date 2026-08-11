#!/usr/bin/env python3
"""Create a test-only rename map from a resolved Bitwig symbol map.

The resulting map renames every resolved class and all of its declared fields
and methods. `BitwigJarTransformer --remap-fixture` applies it across an
untouched JAR, producing a synthetic symbol-only release used to test that the
resolver does not depend on the original obfuscated identifiers.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def remap_descriptor(descriptor: str, classes: dict[str, str]) -> str:
    for source, target in classes.items():
        descriptor = descriptor.replace(f"L{source};", f"L{target};")
    return descriptor


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resolved_map", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    mapping = json.loads(args.resolved_map.read_text())
    classes = {
        entry["source"]: f"CodexFixture{chr(ord('A') + index)}"
        for index, entry in enumerate(mapping["classes"])
    }
    role_sources = {
        role["role"]: (
            method["source_owner"],
            method["source_name"],
            method["source_descriptor"],
        )
        for role in mapping["roles"]
        for method in mapping["methods"]
        if method["target_owner"] == role["owner"]
        and method["target_name"] == role["method"]
        and method["target_descriptor"] == role["descriptor"]
    }
    if len(role_sources) != len(mapping["roles"]):
        raise RuntimeError("could not trace every resolved role back to the reference map")

    field_indexes: defaultdict[str, int] = defaultdict(int)
    for field in mapping["fields"]:
        owner = field["source_owner"]
        index = field_indexes[owner]
        field_indexes[owner] += 1
        field["target_owner"] = classes[owner]
        field["target_name"] = f"f{index:x}"
        field["target_descriptor"] = remap_descriptor(
            field["source_descriptor"], classes
        )

    method_indexes: defaultdict[str, int] = defaultdict(int)
    methods_by_source: dict[tuple[str, str, str], dict[str, str]] = {}
    for method in mapping["methods"]:
        owner = method["source_owner"]
        index = method_indexes[owner]
        method_indexes[owner] += 1
        method["target_owner"] = classes[owner]
        method["target_name"] = (
            method["source_name"]
            if method["source_name"] in {"<init>", "<clinit>"}
            else f"m{index:x}"
        )
        method["target_descriptor"] = remap_descriptor(
            method["source_descriptor"], classes
        )
        methods_by_source[
            (
                method["source_owner"],
                method["source_name"],
                method["source_descriptor"],
            )
        ] = method

    for role in mapping["roles"]:
        source_method = methods_by_source[role_sources[role["role"]]]
        role["owner"] = source_method["target_owner"]
        role["method"] = source_method["target_name"]
        role["descriptor"] = source_method["target_descriptor"]

    for entry in mapping["classes"]:
        entry["target"] = classes[entry["source"]]

    mapping["fixture_only"] = True
    args.output.write_text(json.dumps(mapping, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
