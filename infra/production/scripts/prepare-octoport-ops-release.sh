#!/usr/bin/env bash
set -Eeuo pipefail
umask 0022
NODE_BIN="${OCTOPORT_NODE_BIN:-/root/.nvm/versions/node/v24.20.0/bin/node}"
PNPM_BIN="${OCTOPORT_PNPM_BIN:-/root/.nvm/versions/node/v24.20.0/bin/pnpm}"
fail() { printf '[octoport-ops-release] ERROR: %s\n' "$*" >&2; exit 1; }
build_stage() {
  [[ "$(stat -f -c %T "${tmp}")" == tmpfs ]] || fail "build stage requires a bounded tmpfs"
  python3 -B - "${tmp}" <<'BOUNDS'
import os, sys
fs = os.statvfs(sys.argv[1])
if fs.f_blocks * fs.f_frsize > 1024**3 or fs.f_files > 65536:
    raise SystemExit("OPS_STAGE_FILESYSTEM_LIMIT_MISSING")
BOUNDS
  mkdir -p "${tmp}/.build-tmp" "${tmp}/.build-cache"
  export TMPDIR="${tmp}/.build-tmp" XDG_CACHE_HOME="${tmp}/.build-cache"
python3 -B "${helper}" inputs "${SOURCE_DIR}" >"${tmp}/RELEASE_INPUT_PATHS"
mapfile -t release_paths <"${tmp}/RELEASE_INPUT_PATHS"
git -C "${SOURCE_DIR}" archive --format=tar "${head_sha}" -- "${release_paths[@]}" |
  tar -xf - -C "${tmp}"
python3 -B "${helper}" stage-node "${NODE_BIN}" "${tmp}" "${RELEASE_ROOT}"

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
    env -i HOME="${tmp}/.build-tmp" TMPDIR="${tmp}/.build-tmp" XDG_CACHE_HOME="${tmp}/.build-cache" PATH=/usr/bin:/bin       "${tmp}/.runtime/node" "${tsx_cli}" "${entry}" 2>&1
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

rm -rf -- "${tmp}/.build-tmp" "${tmp}/.build-cache"

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
  python3 -B "${helper}" export-stage "${tmp}" "${publish_tmp}" "${RELEASE_ROOT}" "${NODE_BIN}"
}
[[ "${EUID}" -eq 0 ]] || fail "run as root"
if [[ "${1:-}" == "--build-stage" ]]; then
  [[ "$#" -eq 7 ]] || fail "internal build stage arguments missing"
  SOURCE_DIR="$2"; tmp="$3"; publish_tmp="$4"; RELEASE_ROOT="$5"; head_sha="$6"; tree_sha="$7"
  [[ "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" == "${head_sha}" ]] || fail "source changed before build"
  helper="${SOURCE_DIR}/tooling/operations/ops_release_inputs.py"
  build_stage
  exit 0
fi
SOURCE_DIR="${1:-}"
RELEASE_ROOT="${2:-}"
[[ -n "${SOURCE_DIR}" && -n "${RELEASE_ROOT}" ]] ||
  fail "usage: $0 <clean-source-checkout> <release-root>"
[[ "${SOURCE_DIR}" = /* && "${RELEASE_ROOT}" = /* ]] || fail "paths must be absolute"
case "${RELEASE_ROOT}" in
  /root|/root/*|/home|/home/*|/run/user|/run/user/*) fail "release root is incompatible with ProtectHome=yes" ;;
esac
[[ -x "${NODE_BIN}" && -x "${PNPM_BIN}" ]] || fail "pinned Node/pnpm must be executable"
for command_name in git tar sha256sum python3 install mkdir mv rm chmod grep find sort xargs flock mktemp basename dirname stat systemd-run systemctl; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "missing required command: ${command_name}"
done
SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd -P)"
mkdir -p "${RELEASE_ROOT}"
RELEASE_ROOT="$(cd -- "${RELEASE_ROOT}" && pwd -P)"
head_sha="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
tree_sha="$(git -C "${SOURCE_DIR}" rev-parse HEAD^{tree})"
[[ -z "$(git -C "${SOURCE_DIR}" status --porcelain)" ]] || fail "source checkout must be clean"
exec 9>"${RELEASE_ROOT}/.prepare.lock"
flock -n 9 || fail "another release preparation is active"
helper="${SOURCE_DIR}/tooling/operations/ops_release_inputs.py"
export PATH="$(dirname "${NODE_BIN}"):${PATH}"
store_path="$(cd "${SOURCE_DIR}" && "${PNPM_BIN}" store path)"
[[ "${store_path}" = /* ]] || fail "dependency store must be absolute"
store_root="$(dirname "${store_path}")"
corepack_home="${COREPACK_HOME:-${XDG_CACHE_HOME:-${HOME:-/root}/.cache}/node/corepack}"
python3 -B "${helper}" budget "${RELEASE_ROOT}"
target="${RELEASE_ROOT}/${head_sha}"
[[ ! -e "${target}" ]] || fail "release already exists"
tmp=""
publish_tmp=""
publish_identity=""
unit=""
build_description=""
success=0
cleanup() {
  # The description binds the unit to this invocation's private stage. A
  # colliding pre-existing unit must never be stopped by failure cleanup.
  if [[ -n "${unit}" && "$(systemctl show "${unit}" -p Description --value 2>/dev/null)" == "${build_description}" ]]; then
    case "$(systemctl show "${unit}" -p ActiveState --value 2>/dev/null)" in
      active|activating|reloading|deactivating) systemctl stop "${unit}";;
    esac
  fi
  if [[ -n "${tmp}" ]]; then rm -rf -- "${tmp}"; fi
  if [[ "${success}" -ne 1 ]]; then
    if [[ -n "${publish_tmp}" ]]; then rm -rf -- "${publish_tmp}"; fi
    # rename preserves device/inode identity. This also owns the target if a
    # signal arrives immediately after mv, before the next shell command.
    if [[ -n "${publish_identity}" && -d "${target}" && ! -L "${target}" &&
          "$(stat -c '%d:%i' "${target}" 2>/dev/null)" == "${publish_identity}" ]]; then
      rm -rf -- "${target}"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
tmp="$(mktemp -d "${RELEASE_ROOT}/.ops-${head_sha}.XXXXXX")"
publish_tmp="$(mktemp -d "${RELEASE_ROOT}/.ops-publish-${head_sha}.XXXXXX")"
publish_identity="$(stat -c '%d:%i' "${publish_tmp}")"
unit="octoport-ops-build-$(basename "${tmp}").service"
build_description="Octoport ops build ${head_sha} stage ${tmp}"
[[ "$(systemctl show "${unit}" -p LoadState --value)" == not-found ]] || fail "build unit already exists"
printf '[octoport-ops-release] bounded build unit=%s size=1073741824 inodes=65536 private_store_metadata_size=1048576 inodes=256\n' "${unit}"
systemd-run --unit="${unit}" --description="${build_description}" --quiet --wait --pipe --service-type=exec \
  --property=RuntimeMaxSec=900 --property=KillMode=control-group --property=TimeoutStopSec=5s \
  --property=SendSIGKILL=yes --property=OOMPolicy=stop --property=MemoryAccounting=yes \
  --property=MemoryMax=2147483648 --property=MemorySwapMax=0 --property=TasksMax=1024 \
  --property="TemporaryFileSystem=${tmp}:rw,size=1073741824,nr_inodes=65536,mode=0755" \
  --property=ProtectSystem=strict --property=ProtectHome=read-only \
  --property=NoNewPrivileges=yes --property=CapabilityBoundingSet= \
  --property=PrivateDevices=yes --property=ProtectKernelTunables=yes --property=ProtectControlGroups=yes \
  --property="TemporaryFileSystem=${store_path}/projects:rw,size=1048576,nr_inodes=256,mode=0755" \
  --property="ReadWritePaths=${publish_tmp} ${store_path}/projects" \
  --property="ReadOnlyPaths=${SOURCE_DIR} ${store_root} ${corepack_home} /tmp /var/tmp" \
  --setenv=COREPACK_ENABLE_NETWORK=0 \
  --setenv="OCTOPORT_NODE_BIN=${NODE_BIN}" --setenv="OCTOPORT_PNPM_BIN=${PNPM_BIN}" \
  --setenv="npm_config_store_dir=${store_root}" --setenv="COREPACK_HOME=${corepack_home}" \
  /bin/bash "${SOURCE_DIR}/infra/production/scripts/prepare-octoport-ops-release.sh" \
  --build-stage "${SOURCE_DIR}" "${tmp}" "${publish_tmp}" "${RELEASE_ROOT}" "${head_sha}" "${tree_sha}"
mv -T -n "${publish_tmp}" "${target}"
[[ ! -e "${publish_tmp}" ]] || fail "release target appeared during preparation"
python3 -B "${target}/tooling/operations/verify_ops_release.py" \
  --expected-source-sha "${head_sha}" --expected-source-tree "${tree_sha}" "${target}" >/dev/null ||
  fail "prepared release failed self-verification"
success=1
printf '[octoport-ops-release] prepared %s source=%s tree=%s\n' "${target}" "${head_sha}" "${tree_sha}"
