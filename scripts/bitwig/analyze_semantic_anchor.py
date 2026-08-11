#!/usr/bin/env python3
"""Resolve a name-independent startup anchor between two Bitwig JARs.

This proof of concept deliberately does not modify JARs. It looks for a
structural pattern in BitwigStudioMain:

  static no-argument accessor -> object -> no-argument String method

and raises confidence when the same accessor is also followed by a
no-argument boolean method. Class and method names are reported as output,
but are never used as matching inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


MAIN_CLASS = "com.bitwig.flt.app.BitwigStudioMain"
CALL = re.compile(
    r"^\s*(?P<offset>\d+):\s+"
    r"(?P<opcode>invokestatic|invokevirtual)\s+"
    r"#\d+\s+//\s+(?:InterfaceMethod\s+|Method\s+)?"
    r"(?P<owner>.+)\.(?P<method>[^.:]+):(?P<descriptor>\(.*)$"
)


@dataclass(frozen=True)
class Call:
    offset: int
    opcode: str
    owner: str
    method: str
    descriptor: str


@dataclass(frozen=True)
class Anchor:
    owner: str
    accessor: str
    string_method: str
    boolean_methods: tuple[str, ...]
    string_call_offset: int
    confidence: str


def sha256(path: Path) -> str:
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


def disassemble(jar: Path) -> list[Call]:
    result = subprocess.run(
        ["javap", "-p", "-c", "-classpath", str(jar), MAIN_CLASS],
        check=True,
        capture_output=True,
        text=True,
    )
    calls: list[Call] = []
    for line in result.stdout.splitlines():
        match = CALL.match(line)
        if match:
            calls.append(
                Call(
                    offset=int(match["offset"]),
                    opcode=match["opcode"],
                    owner=match["owner"],
                    method=match["method"],
                    descriptor=match["descriptor"],
                )
            )
    return calls


def find_anchors(calls: list[Call]) -> list[Anchor]:
    anchors: list[Anchor] = []
    for index, call in enumerate(calls[:-1]):
        following = calls[index + 1]
        return_descriptor = f"()L{call.owner};"
        if not (
            call.opcode == "invokestatic"
            and call.descriptor == return_descriptor
            and following.opcode == "invokevirtual"
            and following.owner == call.owner
            and following.descriptor == "()Ljava/lang/String;"
        ):
            continue

        boolean_methods = tuple(
            next_call.method
            for candidate, next_call in zip(calls, calls[1:])
            if candidate.opcode == "invokestatic"
            and candidate.owner == call.owner
            and candidate.method == call.method
            and candidate.descriptor == return_descriptor
            and next_call.opcode == "invokevirtual"
            and next_call.owner == call.owner
            and next_call.descriptor == "()Z"
        )
        confidence = "high" if boolean_methods else "medium"
        anchors.append(
            Anchor(
                owner=call.owner,
                accessor=call.method,
                string_method=following.method,
                boolean_methods=boolean_methods,
                string_call_offset=call.offset,
                confidence=confidence,
            )
        )
    return anchors


def analyze(jar: Path) -> dict[str, object]:
    anchors = find_anchors(disassemble(jar))
    return {
        "jar": str(jar),
        "sha256": sha256(jar),
        "main_class": MAIN_CLASS,
        "anchors": [asdict(anchor) for anchor in anchors],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="older/reference Bitwig JAR")
    parser.add_argument("target", type=Path, help="newer/candidate Bitwig JAR")
    args = parser.parse_args()

    source = analyze(args.source)
    target = analyze(args.target)
    compatible = len(source["anchors"]) == len(target["anchors"]) == 1
    result = {
        "source": source,
        "target": target,
        "semantic_anchor_count_matches": compatible,
        "interpretation": (
            "A single high-confidence startup anchor was found in each JAR. "
            "Its names may differ, but its call shape is the same."
            if compatible
            else "The proof-of-concept anchor is ambiguous or absent; no mapping is asserted."
        ),
    }
    json.dump(result, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
