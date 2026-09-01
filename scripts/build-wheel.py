#!/usr/bin/env python3
"""Wrap an already-compiled binary in a platform-specific Python wheel.

`uvx <dist>` is a first-choice channel because Python-first machines and agent
sandboxes are common, and uvx fetches and caches a wheel for exactly this
platform. The wheel carries no Python code that matters: the binary is installed
as the console script itself, so uvx execs a real executable with no interpreter
in the path.

**It does not care what produced the binary.** Both release workflows use it —
`publish-check.yml` for the bun-compiled `vantage-check`, `publish.yml` for the
Go `vantage` server — and each hands over the same binary it already attached to
the GitHub release, so the wheel and the archive are the same bytes. That
property is the reason this exists rather than a tool that compiles for itself;
see docs/design/pypi-distribution.md §4.5.

Deliberately zero-dependency — no setuptools, no hatchling, no build backend.
A wheel is a zip with three metadata files, and adding a Python build toolchain
to this repo to produce one would cost more than writing the zip out.

Usage:
    python3 scripts/build-wheel.py \\
        --binary dist/vantage-check \\
        --distribution vantage-check \\
        --summary "..." \\
        --readme packages/vantage-check/README.md \\
        --platform-tag manylinux_2_28_x86_64 \\
        --version 0.1.0 \\
        --out-dir wheels
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import stat
import zipfile
from pathlib import Path

HOMEPAGE = "https://github.com/mschulkind-oss/vantage"
LICENSE = "Apache-2.0"


def record_line(archive_path: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest())
    return f"{archive_path},sha256={digest.decode().rstrip('=')},{len(data)}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path)
    parser.add_argument(
        "--platform-tag",
        required=True,
        help="wheel platform tag, e.g. manylinux_2_17_x86_64 or macosx_11_0_arm64",
    )
    parser.add_argument("--version", required=True)
    parser.add_argument("--out-dir", default=Path("dist"), type=Path)
    parser.add_argument(
        "--distribution",
        required=True,
        help="PyPI distribution name, e.g. vantage-check",
    )
    parser.add_argument(
        "--script",
        help="installed command name (default: the distribution name)",
    )
    parser.add_argument("--summary", required=True, help="one-line description")
    parser.add_argument(
        "--readme",
        required=True,
        type=Path,
        help="markdown file to use as the PyPI long description",
    )
    parser.add_argument(
        "--requires-python",
        default=">=3.8",
        help="Requires-Python metadata (default: %(default)s)",
    )
    args = parser.parse_args()

    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error(f"no binary at {binary}")
    if not args.readme.is_file():
        parser.error(f"no readme at {args.readme}")

    distribution: str = args.distribution
    # PEP 503 normalization, which is also the name used inside the archive.
    package = distribution.replace("-", "_")
    description = args.readme.read_text()
    version: str = args.version
    tag = f"py3-none-{args.platform_tag}"
    dist_info = f"{package}-{version}.dist-info"
    data_scripts = f"{package}-{version}.data/scripts"
    # The script name has to be the name the installed executable is invoked by:
    # there is no console-script shim in this wheel, the binary *is* the script,
    # so `uvx vantage-check` resolves `vantage-check` directly. The server's
    # wheel is `vantage-md` carrying a `vantage` script, which is why this is a
    # flag rather than the distribution name (pypi-distribution.md §4.3).
    script_name = args.script or distribution

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
    wheel_path = args.out_dir / f"{package}-{version}-{tag}.whl"

    files: list[tuple[str, bytes, bool]] = [
        (
            f"{package}/__init__.py",
            (
                f'"""{distribution} — see the ``{script_name}`` executable '
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
                f"Name: {distribution}\n"
                f"Version: {version}\n"
                f"Summary: {args.summary}\n"
                f"License: {LICENSE}\n"
                f"Project-URL: Homepage, {HOMEPAGE}\n"
                f"Requires-Python: {args.requires_python}\n"
                "Description-Content-Type: text/markdown\n"
                "\n" + description
            ).encode(),
            False,
        ),
        (
            f"{dist_info}/WHEEL",
            (
                "Wheel-Version: 1.0\n"
                "Generator: vantage build-wheel.py\n"
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
