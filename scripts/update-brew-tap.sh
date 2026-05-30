#!/usr/bin/env bash
# Generate the Homebrew formula for a released vantage version and write it into
# a checkout of the Homebrew tap.
#
# Usage: update-brew-tap.sh <version> <tap-dir>
#   <version>  release version without the leading "v" (e.g. 0.4.0)
#   <tap-dir>  path to a checkout of mschulkind-oss/homebrew-tap
#
# The four release archives must already be attached to the GitHub release for
# tag v<version>; this script downloads them to compute their sha256 sums.
set -euo pipefail

VERSION="${1:?usage: update-brew-tap.sh <version> <tap-dir>}"
TAP_DIR="${2:?usage: update-brew-tap.sh <version> <tap-dir>}"
TAG="v${VERSION}"
REPO="mschulkind-oss/vantage"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

declare -A SHA
for triple in linux_amd64 linux_arm64 darwin_amd64 darwin_arm64; do
  f="vantage_${VERSION}_${triple}.tar.gz"
  # Release asset replication can lag a few seconds behind publish; retry.
  for _ in 1 2 3 4 5 6; do
    if curl -fsSL -o "$f" "${BASE}/${f}"; then break; fi
    echo "asset ${f} not ready, retrying in 15s..." >&2
    sleep 15
  done
  SHA[$triple]="$(sha256sum "$f" | cut -d' ' -f1)"
done

mkdir -p "${TAP_DIR}/Formula"
cat > "${TAP_DIR}/Formula/vantage.rb" <<RUBY
class Vantage < Formula
  desc "Beautiful local Markdown viewer with live reload and Git awareness"
  homepage "https://github.com/mschulkind-oss/vantage"
  version "${VERSION}"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "${BASE}/vantage_${VERSION}_darwin_arm64.tar.gz"
      sha256 "${SHA[darwin_arm64]}"
    end
    on_intel do
      url "${BASE}/vantage_${VERSION}_darwin_amd64.tar.gz"
      sha256 "${SHA[darwin_amd64]}"
    end
  end

  on_linux do
    on_arm do
      url "${BASE}/vantage_${VERSION}_linux_arm64.tar.gz"
      sha256 "${SHA[linux_arm64]}"
    end
    on_intel do
      url "${BASE}/vantage_${VERSION}_linux_amd64.tar.gz"
      sha256 "${SHA[linux_amd64]}"
    end
  end

  def install
    bin.install "vantage"
  end

  test do
    assert_match "vantage-md, version", shell_output("#{bin}/vantage --version")
  end
end
RUBY

echo "Wrote ${TAP_DIR}/Formula/vantage.rb (version ${VERSION})"
