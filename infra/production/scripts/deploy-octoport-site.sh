#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_IPV4="78.17.68.165"
SITE_ROOT="/var/www/octoport-site"
RELEASES_DIR="${SITE_ROOT}/releases"
CURRENT_LINK="${SITE_ROOT}/current"
NGINX_CONF_DIR="/etc/nginx/conf.d"
PREDEPLOY_NAME="octoport-predeploy.conf"
LIVE_NAME="octoport-site.conf"
CERT_FILE="/etc/letsencrypt/live/octoport.ru/fullchain.pem"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${PRODUCTION_DIR}/../.." && pwd)"
SOURCE_SITE="${REPO_ROOT}/apps/site/public"
SOURCE_NGINX="${PRODUCTION_DIR}/nginx/${LIVE_NAME}"
APPS_NGINX="${NGINX_CONF_DIR}/octoport-apps.conf"
SOURCE_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
RELEASE_DIR="${RELEASES_DIR}/${SOURCE_SHA}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/var/backups/octoport-site/${STAMP}"
SUCCESS=0

log() {
  printf '[octoport-site-deploy] %s\n' "$*"
}

fail() {
  printf '[octoport-site-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "run as root"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

assert_clean_checkout() {
  [[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ]] || fail "repository checkout is not clean"
}

assert_source() {
  [[ -f "${SOURCE_NGINX}" ]] || fail "missing ${SOURCE_NGINX}"
  [[ -f "${SCRIPT_DIR}/verify-octoport-site.sh" ]] || fail "missing site verifier"

  local required
  for required in index.html privacy.html support.html install.html styles.css robots.txt sitemap.xml; do
    [[ -f "${SOURCE_SITE}/${required}" ]] || fail "site source is missing ${required}"
  done

  if find "${SOURCE_SITE}" -type l -print -quit | grep -q .; then
    fail "site source must not contain symlinks"
  fi

  grep -Fq '<link rel="canonical" href="https://octoport.ru/"' "${SOURCE_SITE}/index.html" \
    || fail "site source canonical URL is not octoport.ru"
  grep -Fq 'Набор ещё не открыт' "${SOURCE_SITE}/index.html" \
    || fail "site source does not preserve the closed-beta state"
}

assert_existing_app_ingress() {
  [[ -f "${APPS_NGINX}" ]] || fail "missing established app/API ingress ${APPS_NGINX}"
  grep -Fq 'server_name app.octoport.ru;' "${APPS_NGINX}" \
    || fail "app.octoport.ru is missing from established app/API ingress"
  grep -Fq 'proxy_pass http://127.0.0.1:3100;' "${APPS_NGINX}" \
    || fail "app.octoport.ru established proxy target changed"
  grep -Fq 'server_name api.octoport.ru;' "${APPS_NGINX}" \
    || fail "api.octoport.ru is missing from established app/API ingress"
  grep -Fq 'proxy_pass http://127.0.0.1:3000;' "${APPS_NGINX}" \
    || fail "api.octoport.ru established proxy target changed"
}

assert_server_ipv4() {
  local addresses
  addresses="$(ip -o -4 addr show scope global | awk '{print $4}' | cut -d/ -f1)"
  grep -Fxq "${EXPECTED_IPV4}" <<<"${addresses}" || {
    printf '%s\n' "${addresses}" >&2
    fail "expected public IPv4 ${EXPECTED_IPV4} is not configured on this host"
  }
}

assert_dns() {
  local host resolved
  for host in octoport.ru www.octoport.ru app.octoport.ru api.octoport.ru; do
    resolved="$(getent ahostsv4 "${host}" | awk '{print $1}' | sort -u)"
    grep -Fxq "${EXPECTED_IPV4}" <<<"${resolved}" || {
      printf '%s -> %s\n' "${host}" "${resolved:-<no IPv4 answer>}" >&2
      fail "DNS for ${host} does not resolve to ${EXPECTED_IPV4}"
    }
  done
}

assert_tls() {
  [[ -s "${CERT_FILE}" ]] || fail "missing accepted Octoport certificate ${CERT_FILE}"
  openssl x509 -in "${CERT_FILE}" -noout -checkend 604800 >/dev/null \
    || fail "Octoport certificate expires within 7 days"
}

assert_current_path_safe() {
  if [[ -e "${CURRENT_LINK}" || -L "${CURRENT_LINK}" ]]; then
    [[ -L "${CURRENT_LINK}" ]] || fail "${CURRENT_LINK} exists but is not a symlink"
  fi
}

backup_existing_state() {
  install -d -m 0700 "${BACKUP_DIR}"

  shopt -s nullglob
  local file
  for file in "${NGINX_CONF_DIR}"/octoport*.conf; do
    cp -a "${file}" "${BACKUP_DIR}/"
  done
  shopt -u nullglob

  if [[ -L "${CURRENT_LINK}" ]]; then
    readlink -f "${CURRENT_LINK}" >"${BACKUP_DIR}/current-target.txt"
  else
    : >"${BACKUP_DIR}/no-current-link"
  fi

  printf '%s\n' "${SOURCE_SHA}" >"${BACKUP_DIR}/candidate-source-sha.txt"
}

capture_failure_diagnostics() {
  local diagnostics_dir="${BACKUP_DIR}/failure-diagnostics"
  install -d -m 0700 "${diagnostics_dir}" || true

  nginx -T >"${diagnostics_dir}/nginx-T.txt" 2>&1 || true
  ls -la "${NGINX_CONF_DIR}" >"${diagnostics_dir}/conf.d-listing.txt" 2>&1 || true
  systemctl status nginx --no-pager >"${diagnostics_dir}/nginx-status.txt" 2>&1 || true
  readlink -f "${CURRENT_LINK}" >"${diagnostics_dir}/current-target.txt" 2>&1 || true

  {
    local host
    for host in octoport.ru www.octoport.ru app.octoport.ru api.octoport.ru docs.selleragents.ru; do
      printf '%s\n' "--- ${host} ---"
      openssl s_client -connect 127.0.0.1:443 -servername "${host}" </dev/null 2>/dev/null \
        | openssl x509 -noout -subject -issuer -fingerprint -sha256 -ext subjectAltName 2>/dev/null || true
      curl --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' \
        --resolve "${host}:443:127.0.0.1" "https://${host}/" || true
    done
  } >"${diagnostics_dir}/served-state.txt" 2>&1

  log "failure diagnostics captured in ${diagnostics_dir}"
}

restore_previous_state() {
  log "rolling back Octoport site/nginx state"

  rm -f "${NGINX_CONF_DIR}/${LIVE_NAME}" "${NGINX_CONF_DIR}/${PREDEPLOY_NAME}"
  shopt -s nullglob
  local file
  for file in "${BACKUP_DIR}"/octoport*.conf; do
    cp -a "${file}" "${NGINX_CONF_DIR}/"
  done
  shopt -u nullglob

  if [[ -s "${BACKUP_DIR}/current-target.txt" ]]; then
    local previous_target tmp_link
    previous_target="$(cat "${BACKUP_DIR}/current-target.txt")"
    tmp_link="${CURRENT_LINK}.rollback.$$"
    ln -s "${previous_target}" "${tmp_link}"
    mv -Tf "${tmp_link}" "${CURRENT_LINK}"
  elif [[ -f "${BACKUP_DIR}/no-current-link" ]]; then
    rm -f "${CURRENT_LINK}"
  fi

  if nginx -t; then
    systemctl reload nginx || true
  else
    log "WARNING: nginx config test failed during rollback; nginx was not reloaded"
  fi
}

on_exit() {
  local status=$?
  if [[ ${status} -ne 0 && ${SUCCESS} -ne 1 ]]; then
    capture_failure_diagnostics
    restore_previous_state
  fi
  exit "${status}"
}

verify_existing_release() {
  local source_file rel release_file source_count release_count

  source_count="$(find "${SOURCE_SITE}" -type f | wc -l | tr -d ' ')"
  release_count="$(find "${RELEASE_DIR}" -type f | wc -l | tr -d ' ')"
  [[ "${source_count}" == "${release_count}" ]] \
    || fail "existing release file count ${release_count} differs from source ${source_count}"

  while IFS= read -r -d '' source_file; do
    rel="${source_file#${SOURCE_SITE}/}"
    release_file="${RELEASE_DIR}/${rel}"
    [[ -f "${release_file}" ]] || fail "existing release is missing ${rel}"
    cmp -s "${source_file}" "${release_file}" || fail "existing release differs for ${rel}"
  done < <(find "${SOURCE_SITE}" -type f -print0)
}

stage_release() {
  install -d -m 0755 "${RELEASES_DIR}"

  if [[ -d "${RELEASE_DIR}" ]]; then
    log "release ${SOURCE_SHA} already exists; verifying byte parity"
    verify_existing_release
    return
  fi

  install -d -m 0755 "${RELEASE_DIR}"
  cp -a "${SOURCE_SITE}/." "${RELEASE_DIR}/"
  find "${RELEASE_DIR}" -type d -exec chmod 0755 {} +
  find "${RELEASE_DIR}" -type f -exec chmod 0644 {} +
  verify_existing_release
}

switch_current_release() {
  local tmp_link="${CURRENT_LINK}.candidate.$$"
  ln -s "${RELEASE_DIR}" "${tmp_link}"
  mv -Tf "${tmp_link}" "${CURRENT_LINK}"
}

install_live_ingress() {
  install -m 0644 "${SOURCE_NGINX}" "${NGINX_CONF_DIR}/${LIVE_NAME}"
  rm -f "${NGINX_CONF_DIR}/${PREDEPLOY_NAME}"
  nginx -t
  systemctl reload nginx
}

main() {
  require_root
  for command_name in awk cat chmod cmp cp cut find getent git grep install ip ln ls mv nginx openssl readlink rm sleep sort systemctl tr wc curl bash; do
    require_command "${command_name}"
  done

  assert_clean_checkout
  assert_source
  assert_existing_app_ingress
  assert_server_ipv4
  assert_dns
  assert_tls
  assert_current_path_safe
  nginx -t
  systemctl is-active --quiet nginx || fail "nginx is not active"
  systemctl is-active --quiet certbot.timer || fail "certbot.timer is not active"

  backup_existing_state
  trap on_exit EXIT

  log "staging immutable static release ${SOURCE_SHA}"
  stage_release

  log "switching current release symlink"
  switch_current_release

  log "installing live Octoport static-site ingress"
  install_live_ingress

  log "running post-deploy verification"
  EXPECTED_SITE_SHA="${SOURCE_SHA}" bash "${SCRIPT_DIR}/verify-octoport-site.sh"

  SUCCESS=1
  log "PASS: Octoport static site deployed from ${SOURCE_SHA}"
  log "release: ${RELEASE_DIR}"
  log "backup: ${BACKUP_DIR}"
}

main "$@"
