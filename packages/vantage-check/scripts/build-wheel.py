#!/usr/bin/env python3
"""Wrap a built vantage-check binary in a platform-specific Python wheel.

`uvx vantage-check <file>` is the design's first-choice channel because
Python-first agent sandboxes are common, and uvx will fetch and cache a wheel
for exactly this platform. The wheel carries no Python code that matters: the
binary is installed as a script, so uvx execs the real executable with no
interpreter in the path.

Deliberately zero-dependency — no setuptools, no hatchling, no build backend.
A wheel is a zip with three metadata files, and adding a Python build toolchain
to a TypeScript project to produce one would cost more than writing it out.

Usage:
    python3 scripts/build-wheel.py \\
        --binary dist/vantage-check \\
        --platform-tag manylinux_2_28_x86_64 \\
        --version 0.1.0 \\
        --out-dir dist
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import stat
import zipfile
from pathlib import Path

DISTRIBUTION = "vantage-check"
# PEP 503 normalization, which is also the name used inside the archive.
PACKAGE = DISTRIBUTION.replace("-", "_")

SUMMARY = (
    "Vantage's Markdown conventions, and a check that a document really renders"
)

DESCRIPTION = """\
# vantage-check

The agent-facing CLI for [Vantage](https://github.com/mschulkind-oss/vantage).

```console
$ uvx vantage-check docs/            # check that documents really render
$ uvx vantage-check style-guide      # print the conventions Vantage expects
```

Everything works offline against files on disk: no server, no port, no network.

The wheel carries a standalone binary with the runtime already inside it, so
nothing else is installed and no Node.js is required.
"""


def record_line(archive_path: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest())
    return f"{archive_path},sha256={digest.decode().rstrip('=')},{len(data)}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument(
        "--platform-tag",
        required=True,
        help="wheel platform tag, e.g. manylinux_2_28_x86_64 or macosx_11_0_arm64",
    )
    parser.add_argument("--version", required=True)
    parser.add_argument("--out-dir", default=Path("dist"), type=Path)
    args = parser.parse_args()

    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error(f"no binary at {binary}")

    version: str = args.version
    tag = f"py3-none-{args.platform_tag}"
    dist_info = f"{PACKAGE}-{version}.dist-info"
    data_scripts = f"{PACKAGE}-{version}.data/scripts"
    # The script name has to be the name the installed executable is invoked by:
    # there is no console-script shim in this wheel, the binary *is* the script,
    # so `uvx vantage-check` resolves `vantage-check` directly.
    script_name = "vantage-check"

    # Windows is not a target (docs/design/pypi-distribution.md §4.4). It used
    # to be, and it carried the whole reason this check exists: bun suffixes
    # only its Windows output with .exe, so a tag and a binary that disagreed
    # produced a wheel that installed cleanly and failed on first run. Rather
    # than keep that branch alive with nothing exercising it, refuse the tag.
    if "win" in args.platform_tag:
        parser.error(
            f"--platform-tag {args.platform_tag}: Windows is not a supported "
            "target. Re-adding one means restoring the .exe script naming here "
            "and in the release workflow."
        )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    wheel_path = args.out_dir / f"{PACKAGE}-{version}-{tag}.whl"

    files: list[tuple[str, bytes, bool]] = [
        (
            f"{PACKAGE}/__init__.py",
            (
                '"""vantage-check — see the ``vantage-check`` executable '
                'installed alongside this package."""\n'
                f'__version__ = "{version}"\n'
            ).encode(),
            False,
        ),
        (f"{data_scripts}/{script_name}", binary.read_bytes(), True),
        (
            f"{dist_info}/METADATA",
            (
                "Metadata-Version: 2.1\n"
                f"Name: {DISTRIBUTION}\n"
                f"Version: {version}\n"
                f"Summary: {SUMMARY}\n"
                "License: Apache-2.0\n"
                "Project-URL: Homepage, https://github.com/mschulkind-oss/vantage\n"
                "Requires-Python: >=3.8\n"
                "Description-Content-Type: text/markdown\n"
                "\n" + DESCRIPTION
            ).encode(),
            False,
        ),
        (
            f"{dist_info}/WHEEL",
            (
                "Wheel-Version: 1.0\n"
                "Generator: vantage-check build-wheel.py\n"
                # The wheel is platform-specific, so its root belongs in
                # platlib rather than purelib.
                "Root-Is-Purelib: false\n"
                f"Tag: {tag}\n"
            ).encode(),
            False,
        ),
    ]

    records = [record_line(name, data) for name, data, _ in files]
    records.append(f"{dist_info}/RECORD,,")

    with zipfile.ZipFile(wheel_path, "w", zipfile.ZIP_DEFLATED) as wheel:
        for name, data, executable in files:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            mode = 0o755 if executable else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            wheel.writestr(info, data)
        record_info = zipfile.ZipInfo(
            f"{dist_info}/RECORD", date_time=(1980, 1, 1, 0, 0, 0)
        )
        record_info.external_attr = (stat.S_IFREG | 0o644) << 16
        record_info.compress_type = zipfile.ZIP_DEFLATED
        wheel.writestr(record_info, "\n".join(records) + "\n")

    size_mb = wheel_path.stat().st_size / 1024 / 1024
    print(f"wheel: {wheel_path} ({size_mb:.0f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
