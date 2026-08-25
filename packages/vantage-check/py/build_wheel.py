#!/usr/bin/env python3
"""Assemble a platform-tagged wheel embedding the vantage-check binary.

A wheel is just a zip with a `.dist-info` directory. We build it by hand so we
can set an *explicit* platform tag (`linux_x86_64`, `macosx_11_0_arm64`, …) —
that is what lets `uvx`/pip pick the right wheel for the host, and what lets
every wheel be built on a single host (no OS-matched runners).

Usage:
  python3 py/build_wheel.py <binary> <version> <platform-tag> [out-dir]
"""
import base64
import hashlib
import os
import sys
import zipfile

PKG = "vantage_check"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def build(binary: str, version: str, platform_tag: str, out_dir: str = "dist") -> str:
    src_pkg = os.path.join(os.path.dirname(os.path.abspath(__file__)), PKG)

    # The Python package (console script) plus the bundled binary.
    files: dict[str, bytes] = {}
    for name in ("__init__.py", "__main__.py"):
        with open(os.path.join(src_pkg, name), "rb") as f:
            files[f"{PKG}/{name}"] = f.read()
    with open(binary, "rb") as f:
        files[f"{PKG}/vantage-check"] = f.read()

    dist = f"{PKG}-{version}"
    info = f"{dist}.dist-info"
    files[f"{info}/METADATA"] = (
        "Metadata-Version: 2.1\n"
        "Name: vantage-check\n"
        f"Version: {version}\n"
        "Summary: Agent-facing checker for Vantage documents "
        "(compiled single-file binary).\n"
        "Requires-Python: >=3.8\n"
    ).encode("utf-8")
    files[f"{info}/WHEEL"] = (
        "Wheel-Version: 1.0\n"
        "Generator: vantage-check-build\n"
        "Root-Is-Purelib: false\n"
        f"Tag: py3-none-{platform_tag}\n"
    ).encode("utf-8")
    files[f"{info}/entry_points.txt"] = (
        "[console_scripts]\n"
        "vantage-check = vantage_check.__main__:main\n"
    ).encode("utf-8")

    wheel_name = f"{dist}-py3-none-{platform_tag}.whl"
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, wheel_name)

    record_rows: list[str] = []
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
            record_rows.append(f"{name},{_b64url(hashlib.sha256(data).digest())},{len(data)}")
        # RECORD lists every other file; its own row has no hash/size.
        record_body = "\n".join(record_rows) + f"\n{info}/RECORD,,"
        zf.writestr(f"{info}/RECORD", record_body.encode("utf-8"))
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    print(build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "dist"))
