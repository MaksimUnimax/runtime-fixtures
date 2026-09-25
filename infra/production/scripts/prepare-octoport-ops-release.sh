#!/usr/bin/env bash
set -Eeuo pipefail
umask 0022

SOURCE_DIR="${1:-}"
RELEASE_ROOT="${2:-}"
NODE_BIN="${OCTOPORT_NODE_BIN:-/root/.nvm/versions/node/v24.20.0/bin/node}"
PNPM_BIN="${OCTOPORT_PNPM_BIN:-/root/.nvm/versions/node/v24.20.0/bin/pnpm}"

fail() {
  printf '[octoport-ops-release] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "run as root"
[[ -n "${SOURCE_DIR}" && -n "${RELEASE_ROOT}" ]] ||
  fail "usage: $0 <clean-source-checkout> <release-root>"
[[ "${SOURCE_DIR}" = /* && "${RELEASE_ROOT}" = /* ]] ||
  fail "source and release root must be absolute paths"
case "${RELEASE_ROOT}" in
  /root|/root/*|/home|/home/*|/run/user|/run/user/*)
    fail "release root is incompatible with ProtectHome=yes"
    ;;
esac
[[ -x "${NODE_BIN}" ]] || fail "pinned Node binary is not executable"
[[ -x "${PNPM_BIN}" ]] || fail "pinned pnpm binary is not executable"

for command_name in git tar sha256sum python3 install mkdir mv rm chmod grep find sort xargs; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    fail "missing required command: ${command_name}"
done

SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd -P)"
mkdir -p "${RELEASE_ROOT}"
RELEASE_ROOT="$(cd -- "${RELEASE_ROOT}" && pwd -P)"

head_sha="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
tree_sha="$(git -C "${SOURCE_DIR}" rev-parse HEAD^{tree})"
[[ -z "$(git -C "${SOURCE_DIR}" status --porcelain)" ]] ||
  fail "source checkout must be clean"

target="${RELEASE_ROOT}/${head_sha}"
[[ ! -e "${target}" ]] || fail "release already exists: ${target}"
tmp="$(mktemp -d "${RELEASE_ROOT}/.ops-${head_sha}.XXXXXX")"
chmod 0755 "${tmp}"
success=0
cleanup() {
  if [[ "${success}" -ne 1 ]]; then
    rm -rf -- "${tmp}"
    [[ ! -e "${target}" ]] || rm -rf -- "${target}"
  fi
}
trap cleanup EXIT

git -C "${SOURCE_DIR}" archive --format=tar "${head_sha}" |
  tar -xf - -C "${tmp}"
mkdir -p "${tmp}/.runtime"
install -m 0555 "${NODE_BIN}" "${tmp}/.runtime/node"

export PATH="$(dirname "${NODE_BIN}"):${PATH}"
(
  cd "${tmp}"
  CI=true "${PNPM_BIN}" install --offline --frozen-lockfile --ignore-scripts
  "${PNPM_BIN}" --filter @product/telegram-operator exec vitest run src/config.test.ts
  "${PNPM_BIN}" --filter @product/telegram-operator build
  CI=true "${PNPM_BIN}" install --offline --frozen-lockfile --ignore-scripts --prod
)

# pnpm's local content-addressable store can preserve root-only read modes from
# the build host. The immutable release contains no secrets, so normalize the
# payload for a dedicated non-root service while keeping it non-writable.
chmod -R a+rX,go-w "${tmp}"

tsx_cli="${tmp}/apps/telegram-operator/node_modules/tsx/dist/cli.mjs"
entry="${tmp}/apps/telegram-operator/dist/main.js"
[[ -f "${tsx_cli}" && -f "${entry}" ]] ||
  fail "telegram runtime files missing after production install"

set +e
startup_output="$(
  cd "${tmp}" &&
    env -i HOME=/tmp PATH=/usr/bin:/bin       "${tmp}/.runtime/node" "${tsx_cli}" "${entry}" 2>&1
)"
startup_status=$?
set -e
[[ "${startup_status}" -ne 0 ]] ||
  fail "empty-environment startup unexpectedly succeeded"
grep -q "TELEGRAM_OPERATOR_CONFIGURATION_MISSING" <<<"${startup_output}" ||
  fail "release did not reach Telegram configuration gate"
if grep -Eq "ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"   <<<"${startup_output}"; then
  fail "release dependency closure is incomplete"
fi

chmod -R go-w "${tmp}"

HEAD_SHA="${head_sha}" TREE_SHA="${tree_sha}" RELEASE_DIR="${tmp}" python3 - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["RELEASE_DIR"])
manifest = {
    "format": "octoport-ops-release-v1",
    "sourceSha": os.environ["HEAD_SHA"],
    "sourceTree": os.environ["TREE_SHA"],
    "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "runtime": {
        "nodeSha256": hashlib.sha256((root / ".runtime/node").read_bytes()).hexdigest(),
        "entrySha256": hashlib.sha256((root / "apps/telegram-operator/dist/main.js").read_bytes()).hexdigest(),
    },
}
(root / "RELEASE_MANIFEST.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
PY

(
  cd "${tmp}"
  LC_ALL=C find . -type l -printf '%P\t%l\n' | LC_ALL=C sort > RELEASE_SYMLINKS
  LC_ALL=C find . -type f ! -name RELEASE_SHA256SUMS -print0 |
    LC_ALL=C sort -z | xargs -0 sha256sum > RELEASE_SHA256SUMS
)
chmod 0644 "${tmp}/RELEASE_MANIFEST.json" "${tmp}/RELEASE_SYMLINKS" "${tmp}/RELEASE_SHA256SUMS"
if find "${tmp}" \( -type f -o -type d \) -perm /022 -print -quit | grep -q .; then
  fail "release contains group/other-writable files"
fi
if find "${tmp}" ! -user root -print -quit | grep -q .; then
  fail "release must be root-owned"
fi
mv "${tmp}" "${target}"
python3 "${target}/tooling/operations/verify_ops_release.py" "${target}" >/dev/null ||
  fail "prepared release failed self-verification"
success=1
trap - EXIT
printf '[octoport-ops-release] prepared %s source=%s tree=%s\n'   "${target}" "${head_sha}" "${tree_sha}"
