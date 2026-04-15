#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[voice-signing] macOS is required for voice-validation packaging." >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[voice-signing] Full Xcode is not available.
[voice-signing] Install Xcode.app from the App Store or Apple Developer, then run:
[voice-signing]   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
EOF
  exit 1
fi

identities="$(security find-identity -v -p codesigning 2>&1 || true)"

if ! grep -q "Developer ID Application:" <<<"$identities"; then
  cat >&2 <<'EOF'
[voice-signing] No valid Developer ID Application identity was found.
[voice-signing] Open Xcode -> Settings -> Accounts -> Manage Certificates and create/import a Developer ID Application certificate.
[voice-signing] Re-run: security find-identity -v -p codesigning
EOF
  exit 1
fi

echo "[voice-signing] Full Xcode is available."
echo "[voice-signing] Developer ID Application identity detected."
