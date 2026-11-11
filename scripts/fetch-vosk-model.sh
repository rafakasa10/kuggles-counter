#!/usr/bin/env bash
# Downloads the small English Vosk model (Apache-2.0, alphacephei.com), verifies its
# checksum, checks our grammar against its vocabulary, and repackages it as the
# .tar.gz that vosk-browser expects, at public/models/<name>.tar.gz.
#
# Env:
#   VOSK_ZIP=/path/to/zip   reuse an already-downloaded zip instead of fetching
#   WORK_DIR=/path          scratch dir (default: a fresh mktemp dir)
set -euo pipefail

MODEL="vosk-model-small-en-us-0.15"
URL="https://alphacephei.com/vosk/models/${MODEL}.zip"
SHA256="30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/public/models"
OUT="${OUT_DIR}/${MODEL}.tar.gz"
WORK="${WORK_DIR:-$(mktemp -d)}"

if [[ -f "${OUT}" ]]; then
  echo "Model already present: ${OUT}"
  exit 0
fi

mkdir -p "${OUT_DIR}" "${WORK}"
ZIP="${VOSK_ZIP:-${WORK}/${MODEL}.zip}"
if [[ ! -f "${ZIP}" ]]; then
  echo "Downloading ${URL}"
  curl -fSL --retry 3 -o "${ZIP}" "${URL}"
fi

echo "${SHA256}  ${ZIP}" | shasum -a 256 -c -

rm -rf "${WORK:?}/${MODEL}"
unzip -q "${ZIP}" -d "${WORK}"

node "${ROOT}/scripts/check-vosk-vocab.mjs" "${WORK}/${MODEL}"

# vosk-browser strips the first path component, so keep the model folder at the top.
# Write to a temp file and move it, so an interrupted run never leaves a truncated archive
# that the "already present" check would skip. COPYFILE_DISABLE stops macOS adding ._ files.
COPYFILE_DISABLE=1 tar -C "${WORK}" -czf "${OUT}.partial" "${MODEL}"
mv "${OUT}.partial" "${OUT}"
echo "Wrote ${OUT} ($(du -h "${OUT}" | cut -f1))"
