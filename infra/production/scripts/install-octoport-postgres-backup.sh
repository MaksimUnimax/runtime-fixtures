#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_DIR="${1:-}"
BACKUP_USER="${2:-}"
BACKUP_GROUP="${3:-}"
BACKUP_ENV="${4:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SERVICE_TEMPLATE="${PRODUCTION_DIR}/systemd/octoport-postgres-backup.service.in"
TIMER_TEMPLATE="${PRODUCTION_DIR}/systemd/octoport-postgres-backup.timer"
VERIFY_RELEASE="${PRODUCTION_DIR}/../../tooling/operations/verify_ops_release.py"
SERVICE_PATH="/etc/systemd/system/octoport-postgres-backup.service"
TIMER_PATH="/etc/systemd/system/octoport-postgres-backup.timer"
API_ENV="/etc/seller-agents-owner-test/api.env"

fail() {
  printf '[octoport-backup-install] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "run as root"
[[ -n "${RELEASE_DIR}" && -n "${BACKUP_USER}" && -n "${BACKUP_GROUP}" && -n "${BACKUP_ENV}" ]] ||
  fail "usage: $0 <release-dir> <backup-user> <backup-group> <backup-env-file>"
[[ "${RELEASE_DIR}" = /* && "${BACKUP_ENV}" = /* ]] ||
  fail "release dir and backup env must be absolute"
case "${RELEASE_DIR}" in
  /root|/root/*|/home|/home/*|/run/user|/run/user/*)
    fail "release dir is incompatible with ProtectHome=yes"
    ;;
esac
[[ -f "${SERVICE_TEMPLATE}" && -f "${TIMER_TEMPLATE}" ]] ||
  fail "systemd templates missing"
[[ -f "${VERIFY_RELEASE}" ]] || fail "release verifier missing"
[[ -f "${RELEASE_DIR}/tooling/operations/backup_postgres_independent.py" ]] ||
  fail "backup runtime missing"

for command_name in pg_dump pg_restore findmnt runuser systemd-analyze systemctl; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    fail "missing required command: ${command_name}"
done

id "${BACKUP_USER}" >/dev/null 2>&1 || fail "backup user does not exist"
getent group "${BACKUP_GROUP}" >/dev/null || fail "backup group does not exist"
[[ "${BACKUP_USER}" != root && "${BACKUP_GROUP}" != root ]] ||
  fail "dedicated non-root identity is required"

python3 "${VERIFY_RELEASE}" "${RELEASE_DIR}" >/dev/null ||
  fail "release integrity verification failed"

for env_file in "${API_ENV}" "${BACKUP_ENV}"; do
  [[ -f "${env_file}" ]] || fail "required environment file missing"
  [[ "$(stat -c '%U:%G' "${env_file}")" = "root:root" ]] ||
    fail "environment file must remain root-owned"
  if find "${env_file}" -perm /077 -print -quit | grep -q .; then
    fail "environment file permissions are too broad"
  fi
done

readarray -t parsed_paths < <(
  BACKUP_ENV="${BACKUP_ENV}" python3 - <<'PY'
import os
import shlex
from pathlib import Path

wanted = (
    "OCTOPORT_BACKUP_DESTINATION",
    "OCTOPORT_BACKUP_DESTINATION_MOUNT",
    "OCTOPORT_DB_DATA_PATH",
    "OCTOPORT_DB_DATA_MOUNT",
    "OCTOPORT_BACKUP_MIN_FREE_BYTES",
)
values = {}
for raw in Path(os.environ["BACKUP_ENV"]).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit("invalid environment line")
    key, value = line.split("=", 1)
    key = key.strip()
    if key not in wanted:
        continue
    if key in values:
        raise SystemExit(f"duplicate {key}")
    parts = shlex.split(value, posix=True)
    if len(parts) != 1:
        raise SystemExit(f"invalid {key}")
    values[key] = parts[0]
for key in wanted:
    value = values.get(key, "")
    if not value:
        raise SystemExit(f"missing {key}")
    if key == "OCTOPORT_BACKUP_MIN_FREE_BYTES":
        try:
            parsed = int(value)
        except ValueError as error:
            raise SystemExit("invalid OCTOPORT_BACKUP_MIN_FREE_BYTES") from error
        if parsed <= 0:
            raise SystemExit("invalid OCTOPORT_BACKUP_MIN_FREE_BYTES")
        print(parsed)
        continue
    if not Path(value).is_absolute():
        raise SystemExit(f"non-absolute {key}")
    print(value)
PY
) || fail "backup destination configuration invalid"

BACKUP_DESTINATION="${parsed_paths[0]}"
BACKUP_DESTINATION_MOUNT="${parsed_paths[1]}"
DB_DATA_PATH="${parsed_paths[2]}"
DB_DATA_MOUNT="${parsed_paths[3]}"
MIN_FREE_BYTES="${parsed_paths[4]}"
[[ -d "${BACKUP_DESTINATION}" && -d "${BACKUP_DESTINATION_MOUNT}" ]] ||
  fail "backup destination or mount missing"
[[ -e "${DB_DATA_PATH}" && -d "${DB_DATA_MOUNT}" ]] ||
  fail "database data path or mount missing"
resolved_mount="$(readlink -f -- "${BACKUP_DESTINATION_MOUNT}")"
resolved_db_mount="$(readlink -f -- "${DB_DATA_MOUNT}")"
findmnt_target="$(findmnt -n -o TARGET --target "${BACKUP_DESTINATION_MOUNT}" | head -n1)"
findmnt_db_target="$(findmnt -n -o TARGET --target "${DB_DATA_MOUNT}" | head -n1)"
[[ -n "${findmnt_target}" && "$(readlink -f -- "${findmnt_target}")" = "${resolved_mount}" ]] ||
  fail "backup destination mount is not a real mountpoint"
[[ -n "${findmnt_db_target}" && "$(readlink -f -- "${findmnt_db_target}")" = "${resolved_db_mount}" ]] ||
  fail "database data mount is not a real mountpoint"
[[ "$(findmnt -n -o SOURCE --target "${BACKUP_DESTINATION_MOUNT}" | head -n1)" != "$(findmnt -n -o SOURCE --target "${DB_DATA_MOUNT}" | head -n1)" ]] ||
  fail "backup destination is not independent from database storage"
[[ "$(stat -c '%d' "${BACKUP_DESTINATION_MOUNT}")" != "$(stat -c '%d' "${DB_DATA_MOUNT}")" ]] ||
  fail "backup destination is not independent from database storage"
available_bytes="$(df --output=avail -B1 "${BACKUP_DESTINATION}" | tail -n1 | tr -d '[:space:]')"
[[ "${available_bytes}" =~ ^[0-9]+$ && "${available_bytes}" -ge "${MIN_FREE_BYTES}" ]] ||
  fail "backup destination free space is below configured minimum"
runuser -u "${BACKUP_USER}" -- test -w "${BACKUP_DESTINATION}" ||
  fail "backup user cannot write destination"
runuser -u "${BACKUP_USER}" -- test -x "${BACKUP_DESTINATION}" ||
  fail "backup user cannot traverse destination"
runuser -u "${BACKUP_USER}" -- test -r "${RELEASE_DIR}/tooling/operations/backup_postgres_independent.py" ||
  fail "backup user cannot read backup runtime"

if systemctl is-active --quiet octoport-postgres-backup.service ||
   systemctl is-active --quiet octoport-postgres-backup.timer; then
  fail "backup unit is active; use an explicit maintenance action"
fi
if systemctl is-enabled --quiet octoport-postgres-backup.timer 2>/dev/null; then
  fail "backup timer is enabled; use an explicit maintenance action"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf -- "${tmpdir}"' EXIT
SERVICE_OUTPUT="${tmpdir}/octoport-postgres-backup.service"
TIMER_OUTPUT="${tmpdir}/octoport-postgres-backup.timer"

RELEASE_DIR="${RELEASE_DIR}" BACKUP_ENV_FILE="${BACKUP_ENV}" BACKUP_USER="${BACKUP_USER}" BACKUP_GROUP="${BACKUP_GROUP}" BACKUP_DESTINATION_MOUNT="${resolved_mount}" TEMPLATE="${SERVICE_TEMPLATE}" OUTPUT="${SERVICE_OUTPUT}" python3 - <<'PY'
import os
from pathlib import Path

text = Path(os.environ["TEMPLATE"]).read_text()
values = {
    "@RELEASE_DIR@": os.environ["RELEASE_DIR"],
    "@BACKUP_ENV_FILE@": os.environ["BACKUP_ENV_FILE"],
    "@BACKUP_USER@": os.environ["BACKUP_USER"],
    "@BACKUP_GROUP@": os.environ["BACKUP_GROUP"],
    "@BACKUP_DESTINATION_MOUNT@": os.environ["BACKUP_DESTINATION_MOUNT"],
}
for key, value in values.items():
    if key not in text:
        raise SystemExit(f"missing template token {key}")
    text = text.replace(key, value)
if "@" in text:
    raise SystemExit("unresolved template token")
Path(os.environ["OUTPUT"]).write_text(text)
PY

cp "${TIMER_TEMPLATE}" "${TIMER_OUTPUT}"
systemd-analyze verify "${SERVICE_OUTPUT}" "${TIMER_OUTPUT}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -f "${SERVICE_PATH}" || -f "${TIMER_PATH}" ]]; then
  backup_dir="/var/backups/octoport-systemd/${stamp}"
  install -d -m 0700 "${backup_dir}"
  [[ ! -f "${SERVICE_PATH}" ]] || cp -a "${SERVICE_PATH}" "${backup_dir}/"
  [[ ! -f "${TIMER_PATH}" ]] || cp -a "${TIMER_PATH}" "${backup_dir}/"
fi

install -m 0644 "${SERVICE_OUTPUT}" "${SERVICE_PATH}"
install -m 0644 "${TIMER_OUTPUT}" "${TIMER_PATH}"
systemctl daemon-reload
systemd-analyze verify "${SERVICE_PATH}" "${TIMER_PATH}"

printf '%s\n'   "[octoport-backup-install] service/timer installed but NOT enabled or started"   "[octoport-backup-install] release=$(basename -- "${RELEASE_DIR}")"   "[octoport-backup-install] destination-mount=${resolved_mount}"
