#!/bin/sh
# Makes the key that signs releases. Run once, anywhere with openssl:  native/scripts/make-signing-key.sh
#   release-key.pem   the PUBLIC key: commit it as native/release-key.pem (the .deb installs it, and the update script then insists on a valid signature)
#   private key       printed to the terminal ONCE: save it as the repository secret NATIVE_SIGNING_KEY (Settings > Secrets and variables > Actions), and nowhere else
set -eu
dir="$(mktemp -d)"; trap 'rm -rf "$dir"' EXIT
openssl genpkey -algorithm ed25519 -out "$dir/private.pem"
openssl pkey -in "$dir/private.pem" -pubout -out release-key.pem
echo "Wrote release-key.pem (public). Commit it as native/release-key.pem."
echo
echo "The private key follows. Save it as the secret NATIVE_SIGNING_KEY now; it is not kept anywhere:"
echo
cat "$dir/private.pem"
