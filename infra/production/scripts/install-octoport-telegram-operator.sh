#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIR="${1:-}"
SERVICE_USER="${2:-}"
SERVICE_GROUP="${3:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${PRODUCTION_DIR}/systemd/octoport-telegram-operator.service.in"
VERIFY_RELEASE="${PRODUCTION_DIR}/../../tooling/operations/verify_ops_release.py"
UNIT_PATH="/etc/systemd/system/octoport-telegram-operator.service"
API_ENV="/etc/seller-agents-owner-test/api.env"
TELEGRAM_ENV="/root/octoport-owner-intake/telegram.env"

fail() {
  printf '[octoport-telegram-install] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "run as root"
[[ -n "${RELEASE_DIR}" && -n "${SERVICE_USER}" && -n "${SERVICE_GROUP}" ]] ||
  fail "usage: $0 <release-dir> <service-user> <service-group>"
[[ "${RELEASE_DIR}" = /* ]] || fail "release dir must be absolute"
case "${RELEASE_DIR}" in
  /root|/root/*|/home|/home/*|/run/user|/run/user/*)
    fail "release dir is incompatible with ProtectHome=yes"
    ;;
esac
[[ -f "${TEMPLATE}" ]] || fail "systemd template missing"
[[ -f "${VERIFY_RELEASE}" ]] || fail "release verifier missing"
id "${SERVICE_USER}" >/dev/null 2>&1 || fail "service user does not exist"
getent group "${SERVICE_GROUP}" >/dev/null || fail "service group does not exist"
[[ "${SERVICE_USER}" != root && "${SERVICE_GROUP}" != root ]] ||
  fail "dedicated non-root identity is required"

resolved="$(readlink -f -- "${RELEASE_DIR}")"
[[ "${resolved}" = "${RELEASE_DIR}" ]] ||
  fail "release dir must not be a symlink"
[[ -f "${RELEASE_DIR}/RELEASE_MANIFEST.json" ]] ||
  fail "release manifest missing"
[[ -f "${RELEASE_DIR}/RELEASE_SHA256SUMS" ]] ||
  fail "release checksum list missing"
[[ -f "${RELEASE_DIR}/RELEASE_SYMLINKS" ]] ||
  fail "release symlink inventory missing"
[[ -x "${RELEASE_DIR}/.runtime/node" ]] ||
  fail "release Node runtime missing"
[[ -f "${RELEASE_DIR}/apps/telegram-operator/dist/main.js" ]] ||
  fail "telegram entry missing"
[[ -f "${RELEASE_DIR}/apps/telegram-operator/node_modules/tsx/dist/cli.mjs" ]] ||
  fail "telegram tsx runtime missing"

python3 "${VERIFY_RELEASE}" "${RELEASE_DIR}" >/dev/null ||
  fail "release integrity verification failed"
SOURCE_SHA="$(
  RELEASE_DIR="${RELEASE_DIR}" python3 - <<'PY'
import json
import os
import re
from pathlib import Path

manifest = json.loads((Path(os.environ["RELEASE_DIR"]) / "RELEASE_MANIFEST.json").read_text())
if manifest.get("format") != "octoport-ops-release-v1":
    raise SystemExit(2)
sha = str(manifest.get("sourceSha", ""))
if not re.fullmatch(r"[0-9a-f]{40}", sha):
    raise SystemExit(3)
print(sha)
PY
)" || fail "release manifest invalid"

[[ "$(basename -- "${RELEASE_DIR}")" = "${SOURCE_SHA}" ]] ||
  fail "release directory name must equal source SHA"
[[ "$(stat -c '%U:%G' "${RELEASE_DIR}")" = "root:root" ]] ||
  fail "release root must be root-owned"
if find "${RELEASE_DIR}" ! -user root -print -quit | grep -q .; then
  fail "release contains non-root-owned entries"
fi
if find "${RELEASE_DIR}" \( -type f -o -type d \) -perm /022 -print -quit | grep -q .; then
  fail "release contains group/other-writable entries"
fi
command -v runuser >/dev/null 2>&1 || fail "runuser is required"
runuser -u "${SERVICE_USER}" -- test -x "${RELEASE_DIR}/.runtime/node" ||
  fail "service user cannot execute pinned Node"
runuser -u "${SERVICE_USER}" -- test -r "${RELEASE_DIR}/apps/telegram-operator/dist/main.js" ||
  fail "service user cannot read Telegram entry"

set +e
service_probe="$(
  runuser -u "${SERVICE_USER}" -- env -i HOME=/tmp PATH=/usr/bin:/bin \
    "${RELEASE_DIR}/.runtime/node" \
    "${RELEASE_DIR}/apps/telegram-operator/node_modules/tsx/dist/cli.mjs" \
    "${RELEASE_DIR}/apps/telegram-operator/dist/main.js" 2>&1
)"
service_probe_status=$?
set -e
[[ "${service_probe_status}" -ne 0 ]] ||
  fail "service-user empty-environment startup unexpectedly succeeded"
grep -q "TELEGRAM_OPERATOR_CONFIGURATION_MISSING" <<<"${service_probe}" ||
  fail "service user cannot reach Telegram configuration gate"
if grep -Eq "ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|EACCES" <<<"${service_probe}"; then
  fail "service-user release dependency or permission closure is incomplete"
fi

runuser -u "${SERVICE_USER}" -- test -r "${RELEASE_DIR}/apps/telegram-operator/node_modules/tsx/dist/cli.mjs" ||
  fail "service user cannot read Telegram tsx runtime"
set +e
service_preflight_output="$(
  runuser -u "${SERVICE_USER}" -- env -i HOME=/tmp PATH=/usr/bin:/bin \
    "${RELEASE_DIR}/.runtime/node" \
    "${RELEASE_DIR}/apps/telegram-operator/node_modules/tsx/dist/cli.mjs" \
    "${RELEASE_DIR}/apps/telegram-operator/dist/main.js" 2>&1
)"
service_preflight_status=$?
set -e
[[ "${service_preflight_status}" -ne 0 ]] ||
  fail "service-user empty-environment startup unexpectedly succeeded"
grep -q "TELEGRAM_OPERATOR_CONFIGURATION_MISSING" <<<"${service_preflight_output}" ||
  fail "service-user runtime did not reach Telegram configuration gate"
if grep -Eq "ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|EACCES" \
  <<<"${service_preflight_output}"; then
  fail "service-user runtime dependency/access preflight failed"
fi

for secret_file in "${API_ENV}" "${TELEGRAM_ENV}"; do
  [[ -f "${secret_file}" ]] || fail "required environment file missing"
  [[ "$(stat -c '%U:%G' "${secret_file}")" = "root:root" ]] ||
    fail "environment file must remain root-owned"
  if find "${secret_file}" -perm /077 -print -quit | grep -q .; then
    fail "environment file permissions are too broad"
  fi
done

tmp="$(mktemp)"
trap 'rm -f -- "${tmp}"' EXIT
RELEASE_DIR="${RELEASE_DIR}" SERVICE_USER="${SERVICE_USER}" SERVICE_GROUP="${SERVICE_GROUP}" TEMPLATE="${TEMPLATE}" OUTPUT="${tmp}" python3 - <<'PY'
import os
from pathlib import Path

text = Path(os.environ["TEMPLATE"]).read_text()
values = {
    "@RELEASE_DIR@": os.environ["RELEASE_DIR"],
    "@SERVICE_USER@": os.environ["SERVICE_USER"],
    "@SERVICE_GROUP@": os.environ["SERVICE_GROUP"],
}
for key, value in values.items():
    if key not in text:
        raise SystemExit(f"missing template token {key}")
    text = text.replace(key, value)
if "@" in text:
    raise SystemExit("unresolved template token")
Path(os.environ["OUTPUT"]).write_text(text)
PY

systemd-analyze verify "${tmp}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f "${UNIT_PATH}" ]]; then
  backup_dir="/var/backups/octoport-systemd/${stamp}"
  install -d -m 0700 "${backup_dir}"
  cp -a "${UNIT_PATH}" "${backup_dir}/"
fi
install -m 0644 "${tmp}" "${UNIT_PATH}"
systemctl daemon-reload
systemd-analyze verify "${UNIT_PATH}"

printf '%s\n'   "[octoport-telegram-install] unit installed but NOT enabled or started"   "[octoport-telegram-install] release=${SOURCE_SHA}"   "[octoport-telegram-install] resource ceilings remain a measured deployment gate"
