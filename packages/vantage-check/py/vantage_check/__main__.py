"""Console entry point: exec the bundled vantage-check binary.

The wheel carries an explicit platform tag, so pip/uvx only install the wheel
matching the host — the bundled binary is therefore always for this platform.
Wheels do not preserve the executable bit, so restore it before exec.
"""
import os
import stat
import sys


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    is_windows = os.name == "nt"
    binary = os.path.join(here, "vantage-check.exe" if is_windows else "vantage-check")
    if not os.path.exists(binary):
        sys.stderr.write(f"vantage-check: bundled binary not found at {binary}\n")
        sys.exit(1)
    try:
        st = os.stat(binary)
        os.chmod(binary, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass
    os.execv(binary, [binary] + sys.argv[1:])


if __name__ == "__main__":
    main()
