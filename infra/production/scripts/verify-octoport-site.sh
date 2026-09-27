#!/usr/bin/env bash
set -Eeuo pipefail

SITE_ROOT="/var/www/octoport-site"
CURRENT_LINK="${SITE_ROOT}/current"
CERT_FILE="/etc/letsencrypt/live/octoport.ru/fullchain.pem"
DOMAINS=(octoport.ru www.octoport.ru app.octoport.ru api.octoport.ru)
EXPECTED_SITE_SHA="${EXPECTED_SITE_SHA:-}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-20}"
RETRY_DELAY="${RETRY_DELAY:-0.5}"

log() {
  printf '[octoport-site-verify] %s\n' "$*"
}

fail() {
  printf '[octoport-site-verify] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

http_status() {
  local url=$1 host=$2 port=$3
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --resolve "${host}:${port}:127.0.0.1" "${url}"
}

expect_status_with_retry() {
  local expected=$1 url=$2 host=$3 port=$4
  local attempt actual=""
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    actual="$(http_status "${url}" "${host}" "${port}" || true)"
    if [[ "${actual}" == "${expected}" ]]; then
      if (( attempt > 1 )); then
        log "${host} converged to HTTP ${expected} on attempt ${attempt}/${MAX_ATTEMPTS}"
      fi
      return 0
    fi
    sleep "${RETRY_DELAY}"
  done
  fail "${url} returned ${actual:-<no status>}, expected ${expected} after ${MAX_ATTEMPTS} attempts"
}

header_value() {
  local headers=$1 name=$2
  awk -v target="${name}" '
    BEGIN { IGNORECASE=1 }
    {
      line=$0
      sub(/\r$/, "", line)
      split(line, parts, ":")
      if (tolower(parts[1]) == tolower(target)) {
        sub(/^[^:]+:[[:space:]]*/, "", line)
        print line
        exit
      }
    }
  ' <<<"${headers}"
}

expect_redirect() {
  local expected_location=$1 url=$2 host=$3 port=$4
  local headers location

  expect_status_with_retry 308 "${url}" "${host}" "${port}"
  headers="$(curl --silent --show-error --head --resolve "${host}:${port}:127.0.0.1" "${url}")"
  location="$(header_value "${headers}" 'location')"
  [[ "${location}" == "${expected_location}" ]] \
    || fail "${url} redirect location is ${location:-<missing>}, expected ${expected_location}"
}

check_release() {
  [[ -L "${CURRENT_LINK}" ]] || fail "${CURRENT_LINK} is not a symlink"
  local target
  target="$(readlink -f "${CURRENT_LINK}")"
  [[ -d "${target}" ]] || fail "current release target does not exist: ${target}"

  local required
  for required in index.html seller-analytics.html privacy.html support.html install.html favicon.png styles.css robots.txt sitemap.xml; do
    [[ -f "${target}/${required}" ]] || fail "current release is missing ${required}"
  done

  if [[ -n "${EXPECTED_SITE_SHA}" ]]; then
    [[ "$(basename "${target}")" == "${EXPECTED_SITE_SHA}" ]] \
      || fail "current release is $(basename "${target}"), expected ${EXPECTED_SITE_SHA}"
  fi

  log "current release: ${target}"
}

check_certificate_file() {
  [[ -s "${CERT_FILE}" ]] || fail "missing certificate ${CERT_FILE}"
  openssl x509 -in "${CERT_FILE}" -noout -checkend 604800 >/dev/null \
    || fail "Octoport certificate expires within 7 days"

  local san domain
  san="$(openssl x509 -in "${CERT_FILE}" -noout -ext subjectAltName)"
  for domain in "${DOMAINS[@]}"; do
    grep -Fq "DNS:${domain}" <<<"${san}" || fail "certificate SAN does not contain ${domain}"
  done
}

check_served_certificates() {
  local expected_fp host attempt served_fp=""
  expected_fp="$(openssl x509 -in "${CERT_FILE}" -noout -fingerprint -sha256 | cut -d= -f2)"

  for host in "${DOMAINS[@]}"; do
    for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
      served_fp="$(openssl s_client -connect 127.0.0.1:443 -servername "${host}" </dev/null 2>/dev/null \
        | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
        | cut -d= -f2 || true)"
      if [[ "${served_fp}" == "${expected_fp}" ]]; then
        if (( attempt > 1 )); then
          log "${host} certificate converged on attempt ${attempt}/${MAX_ATTEMPTS}"
        fi
        break
      fi
      sleep "${RETRY_DELAY}"
    done
    [[ "${served_fp}" == "${expected_fp}" ]] || fail "${host} is not serving the Octoport certificate"
  done
}

check_site_content() {
  expect_status_with_retry 200 'https://octoport.ru/' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/seller-analytics' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/privacy' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/support' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/install' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/favicon.png' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/styles.css' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/robots.txt' octoport.ru 443
  expect_status_with_retry 200 'https://octoport.ru/sitemap.xml' octoport.ru 443

  local homepage homepage_headers css_headers favicon_headers content_type homepage_csp css_csp
  local seller privacy support install sitemap
  local homepage_cache css_cache css_frame_options css_nosniff favicon_type favicon_location

  homepage="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/')"
  grep -Fq '<title>Подключите ваш ИИ к Ozon и Wildberries | Octoport</title>' <<<"${homepage}" \
    || fail "homepage M12 title is missing"
  grep -Fq '<h1>Подключите ваш ИИ к Ozon и Wildberries</h1>' <<<"${homepage}" \
    || fail "homepage M12 H1 is missing"
  grep -Fq 'Ваш ИИ получает руки для работы с маркетплейсами.' <<<"${homepage}" \
    || fail "homepage brand subheadline is missing"
  grep -Fq '<link rel="icon" href="/favicon.png" type="image/png" />' <<<"${homepage}" \
    || fail "homepage favicon link is missing"
  grep -Fq 'Набор ещё не открыт' <<<"${homepage}" || fail "homepage beta-state copy is missing"

  python3 -c 'import json,re,sys; h=sys.stdin.read(); nodes=[json.loads(x) for x in re.findall(r"<script[^>]+type=[\"'"'"']application/ld\+json[\"'"'"'][^>]*>(.*?)</script>",h,re.I|re.S)]; w=[x for x in nodes if x.get("@type")=="WebSite"]; assert len(w)==1; x=w[0]; assert x.get("name")=="Octoport"; assert x.get("alternateName")==["Октопорт","octoport.ru"]; assert x.get("url")=="https://octoport.ru/"' \
    <<<"${homepage}" || fail "homepage WebSite structured data is invalid"

  seller="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/seller-analytics')"
  privacy="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/privacy')"
  support="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/support')"
  install="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/install')"
  sitemap="$(curl --silent --show-error --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/sitemap.xml')"

  grep -Fq '<title>ИИ для аналитики маркетплейсов — данные вашего магазина | Octoport</title>' <<<"${seller}" \
    || fail "seller analytics M12 title is missing"
  grep -Fq '<h1>Анализируйте данные магазина на Ozon и Wildberries с вашим ИИ</h1>' <<<"${seller}" \
    || fail "seller analytics M12 H1 is missing"
  grep -Fq '<link rel="canonical" href="https://octoport.ru/seller-analytics" />' <<<"${seller}" \
    || fail "seller analytics canonical is missing"
  grep -Fq 'Это read-only сценарий.' <<<"${seller}" || fail "seller analytics read-only boundary is missing"
  grep -Fq 'главной странице Octoport' <<<"${seller}" || fail "seller analytics HOME link is missing"

  grep -Fq '<title>Octoport — Privacy</title>' <<<"${privacy}" || fail "privacy page title is missing"
  grep -Fq 'не сохраняет Ozon/Wildberries реквизиты' <<<"${privacy}" || fail "privacy page credential boundary is missing"
  grep -Fq 'технический срок хранения один час' <<<"${privacy}" || fail "privacy page one-hour local buffer statement is missing"
  grep -Fq 'support@octoport.ru' <<<"${privacy}" || fail "privacy page support contact is missing"
  grep -Fq 'DOM-данные или снимки страниц, просматриваемых пользователем, включая страницы с данными покупателей' <<<"${privacy}" \
    || fail "privacy page customer/user page DOM and screenshot boundary is missing"
  if grep -Eiq 'мы не храним данные|Octoport ничего не хранит|не хранит никаких данных|we store no data|no data stored' \
    <<<"${privacy}"; then
    fail "privacy page contains an unsupported claim that Octoport stores no data"
  fi

  grep -Fq '<title>Octoport — Support</title>' <<<"${support}" || fail "support page title is missing"
  grep -Fq 'support@octoport.ru' <<<"${support}" || fail "support page contact is missing"
  grep -Fq 'Safari в бету не входит' <<<"${support}" || fail "support page Safari beta boundary is missing"
  grep -Fq 'Не отправляйте секреты' <<<"${support}" || fail "support page sensitive-data warning is missing"
  grep -Fq 'Редактирование цен, карточек товаров и ставок не поддерживается' <<<"${support}" \
    || fail "support page read-only boundary is missing"
  grep -Fq 'не отправляйте полные экспорты AI-разговоров' <<<"${support}" \
    || fail "support page AI conversation export warning is missing"
  grep -Fq 'более поздний безопасный для конфиденциальности канал поддержки прямо их не запросит' <<<"${support}" \
    || fail "support page AI conversation export exception is missing"
  grep -Fq 'Одобрение магазина и готовность продукта — разные этапы.' <<<"${support}" \
    || fail "support page must distinguish store approval from product readiness"

  grep -Fq '<title>Install Octoport</title>' <<<"${install}" || fail "install page title is missing"
  grep -Fq 'Официальная установка Octoport из каталога расширений готовится' <<<"${install}" \
    || fail "install page does not state that catalog installation is being prepared"
  if grep -Eiq 'официальн.{0,30}(одобрен(а|о|ы)?|опубликован(а|о|ы)?)\b|магазин.{0,30}(одобрил|одобрен(а|о|ы)?|опубликован(а|о|ы)?|approved|published)\b|каталог.{0,30}(одобрен(а|о|ы)?|опубликован(а|о|ы)?|approved|published)\b|карточк.{0,30}(одобрена|опубликована|approved|published)\b|store.{0,20}(approved|published)\b|Safari.{0,30}(поддерживается|входит в бету|supported)' \
    <<<"${support}${install}"; then
    fail "support/install page contains an unsupported store or Safari claim"
  fi
  for page in "${privacy}" "${support}" "${install}"; do
    grep -Fq 'Octoport' <<<"${page}" || fail "public page is missing Octoport branding"
    if grep -Eiq 'localhost|chrome://extensions|file://' <<<"${page}"; then
      fail "public page contains a development installation route"
    fi
  done

  grep -Fq 'name="description" content="Как Octoport обрабатывает данные:' <<<"${privacy}" \
    || fail "privacy meta description is missing"
  ! grep -Eiq '<meta[^>]+name=["'"'"']robots["'"'"'][^>]+noindex' <<<"${privacy}" \
    || fail "privacy must remain indexable"

  grep -Fq 'name="description" content="Поддержка Octoport:' <<<"${support}" \
    || fail "support meta description is missing"
  ! grep -Eiq '<meta[^>]+name=["'"'"']robots["'"'"'][^>]+noindex' <<<"${support}" \
    || fail "support must remain indexable"

  grep -Fq '<meta name="robots" content="noindex, follow" />' <<<"${install}" \
    || fail "install noindex directive is missing"

  python3 -c 'import sys,xml.etree.ElementTree as ET; root=ET.fromstring(sys.stdin.read()); ns={"s":"http://www.sitemaps.org/schemas/sitemap/0.9"}; loc=[x.text for x in root.findall("s:url/s:loc",ns)]; assert loc==["https://octoport.ru/","https://octoport.ru/seller-analytics","https://octoport.ru/privacy","https://octoport.ru/support"],loc' \
    <<<"${sitemap}" || fail "sitemap canonical URL set is invalid"

  favicon_headers="$(curl --silent --show-error --head --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/favicon.png')"
  favicon_type="$(header_value "${favicon_headers}" 'content-type')"
  [[ "${favicon_type}" == image/png* ]] || fail "favicon content-type is ${favicon_type:-<missing>}"
  favicon_location="$(header_value "${favicon_headers}" 'location')"
  [[ -z "${favicon_location}" ]] || fail "favicon must not redirect: ${favicon_location}"

  homepage_headers="$(curl --silent --show-error --head --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/')"
  homepage_csp="$(header_value "${homepage_headers}" 'content-security-policy')"
  grep -Fq "default-src 'none'" <<<"${homepage_csp}" || fail "homepage CSP is missing the restrictive default-src"
  homepage_cache="$(header_value "${homepage_headers}" 'cache-control')"
  grep -Fqi 'no-cache' <<<"${homepage_cache}" || fail "homepage cache-control is ${homepage_cache:-<missing>}, expected no-cache"

  css_headers="$(curl --silent --show-error --head --resolve 'octoport.ru:443:127.0.0.1' 'https://octoport.ru/styles.css')"
  content_type="$(header_value "${css_headers}" 'content-type')"
  [[ "${content_type}" == text/css* ]] || fail "styles.css content-type is ${content_type:-<missing>}"

  # These checks specifically protect nginx add_header inheritance. Location-level
  # cache policy must never silently remove the site security headers.
  css_csp="$(header_value "${css_headers}" 'content-security-policy')"
  grep -Fq "default-src 'none'" <<<"${css_csp}" || fail "styles.css lost the inherited CSP"
  css_frame_options="$(header_value "${css_headers}" 'x-frame-options')"
  [[ "${css_frame_options}" == 'DENY' ]] || fail "styles.css lost X-Frame-Options"
  css_nosniff="$(header_value "${css_headers}" 'x-content-type-options')"
  [[ "${css_nosniff}" == 'nosniff' ]] || fail "styles.css lost X-Content-Type-Options"
  css_cache="$(header_value "${css_headers}" 'cache-control')"
  grep -Fq 'max-age=300' <<<"${css_cache}" || fail "styles.css cache-control is ${css_cache:-<missing>}, expected max-age=300"
}

check_redirects() {
  local host src target expected

  for host in "${DOMAINS[@]}"; do
    expect_status_with_retry 308 "http://${host}/" "${host}" 80
  done

  expect_redirect 'https://octoport.ru/site-s1-check?probe=1' \
    'http://www.octoport.ru/site-s1-check?probe=1' www.octoport.ru 80
  expect_redirect 'https://octoport.ru/site-s1-check?probe=1' \
    'https://www.octoport.ru/site-s1-check?probe=1' www.octoport.ru 443

  while IFS='|' read -r src target; do
    [[ -n "${src}" ]] || continue
    expected="https://octoport.ru${target}?probe=1"
    expect_redirect "${expected}" "https://octoport.ru${src}?probe=1" octoport.ru 443
  done <<'EOF'
/index.html|/
/seller-analytics.html|/seller-analytics
/seller-analytics/|/seller-analytics
/privacy.html|/privacy
/privacy/|/privacy
/support.html|/support
/support/|/support
/install.html|/install
/install/|/install
EOF

  expect_status_with_retry 404 'https://octoport.ru/m14-verifier-unknown' octoport.ru 443
}

check_application_routes() {
  expect_status_with_retry 200 'https://app.octoport.ru/' app.octoport.ru 443
  expect_status_with_retry 200 'https://app.octoport.ru/login' app.octoport.ru 443

  local health body
  for health in live ready; do
    expect_status_with_retry 200 "https://api.octoport.ru/health/${health}" api.octoport.ru 443
    body="$(curl --silent --show-error --resolve 'api.octoport.ru:443:127.0.0.1' "https://api.octoport.ru/health/${health}")"
    python3 -c 'import json,sys; assert json.load(sys.stdin).get("status") == sys.argv[1]' "${health}" <<<"${body}" \
      || fail "API ${health} route returned an invalid health response"
  done

  # Read-only anonymous request checks portal -> API routing and its auth guard.
  expect_status_with_retry 401 'https://app.octoport.ru/api/control-plane/v1/accounts' app.octoport.ru 443
  body="$(curl --silent --show-error --resolve 'app.octoport.ru:443:127.0.0.1' 'https://app.octoport.ru/api/control-plane/v1/accounts')"
  python3 -c 'import json,sys; assert json.load(sys.stdin).get("error", {}).get("code") == "AUTH_SESSION_INVALID"' <<<"${body}" \
    || fail "portal control-plane route did not preserve the anonymous authentication guard"
}

check_old_docs_service() {
  local status subject
  status="$(http_status 'https://docs.selleragents.ru/' docs.selleragents.ru 443 || true)"
  [[ "${status}" =~ ^[1-4][0-9][0-9]$ ]] || fail "docs.selleragents.ru returned unhealthy status ${status}"

  subject="$(openssl s_client -connect 127.0.0.1:443 -servername docs.selleragents.ru </dev/null 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null || true)"
  grep -Fq 'docs.selleragents.ru' <<<"${subject}" || fail "docs.selleragents.ru certificate changed unexpectedly: ${subject:-<missing>}"
}

check_admin_not_enabled() {
  if nginx -T 2>&1 | grep -E 'server_name[^;]*admin\.octoport\.ru' >/dev/null; then
    fail "admin.octoport.ru is configured as an nginx application hostname"
  fi
}

main() {
  for command_name in awk basename curl grep nginx openssl readlink systemctl python3; do
    require_command "${command_name}"
  done

  nginx -t
  check_release
  check_certificate_file
  check_served_certificates
  check_site_content
  check_redirects
  check_application_routes
  check_old_docs_service
  check_admin_not_enabled
  systemctl is-active --quiet nginx || fail "nginx is not active"
  systemctl is-active --quiet certbot.timer || fail "certbot.timer is not active"

  log "PASS: live static site, inherited security headers, TLS, redirects, deployed app/API routes and anonymous authentication guard and old docs service"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
