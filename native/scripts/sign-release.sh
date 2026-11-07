#!/bin/bash
# Signs release files with the private key in $KEY (the NATIVE_SIGNING_KEY secret): one <file>.sig next to each file, base64 of an ed25519 signature, the form wobbly-clock-update checks.
#   KEY="$NATIVE_SIGNING_KEY" PUBKEY=native/release-key.pem native/scripts/sign-release.sh FILE...
# A secret pasted into a web form often loses its BEGIN/END lines or its line breaks, so the base64 body is taken out and wrapped again; the key must then load, every signature must be
# non-empty, and (when PUBKEY exists) verify with the committed public key: a release the clocks would refuse is never published.
set -euo pipefail
[ -n "${KEY:-}" ] || { echo "::error::KEY (the private key) is empty"; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
body="$(printf '%s' "$KEY" | sed -e 's/-----[A-Z ]*-----//g' | tr -d ' \t\r\n')"
{ echo '-----BEGIN PRIVATE KEY-----'; printf '%s' "$body" | fold -w 64; echo; echo '-----END PRIVATE KEY-----'; } > "$tmp/key.pem"
if ! openssl pkey -in "$tmp/key.pem" -noout 2>/dev/null; then
  echo "::error::NATIVE_SIGNING_KEY is not a private key openssl can read. It must be the whole private key as made by 'openssl genpkey -algorithm ed25519' (the BEGIN and END lines included), saved as a repository secret."
  exit 1
fi
for f in "$@"; do
  openssl pkeyutl -sign -rawin -inkey "$tmp/key.pem" -in "$f" | base64 -w0 > "$f.sig"
  [ -s "$f.sig" ] || { echo "::error::the signature of $f is empty"; exit 1; }
  if [ -n "${PUBKEY:-}" ] && [ -f "$PUBKEY" ]; then
    base64 -d < "$f.sig" > "$tmp/sig.bin"
    openssl pkeyutl -verify -rawin -pubin -inkey "$PUBKEY" -sigfile "$tmp/sig.bin" -in "$f" > /dev/null \
      || { echo "::error::the signature of $f does not verify with $PUBKEY: the private key in the secret is not the one that goes with the committed public key."; exit 1; }
  fi
  echo "signed $f"
done
