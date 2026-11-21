#!/bin/sh
set -eu
: "${OPENROUTER_PROXY_LISTEN:?Set the router interface and port}"
: "${OPENROUTER_ALLOWED_CLIENTS:?Set the allowed Octoport source addresses}"
root=/etc/octoport-openrouter
cd "$(dirname "$0")"
python3 - "$OPENROUTER_PROXY_LISTEN" "$OPENROUTER_ALLOWED_CLIENTS" <<'PY'
import ipaddress
import sys
host, port = sys.argv[1].rsplit(":", 1)
ipaddress.ip_address(host.strip("[]"))
if not port.isdecimal() or not 0 < int(port) <= 65535:
    raise SystemExit("Invalid port")
for source in sys.argv[2].split(" "):
    network = ipaddress.ip_network(source, strict=False)
    if network.prefixlen == 0:
        raise SystemExit("Specify the Octoport source network")
PY
install -d -m 0755 "$root/empty"
install -D -m 0644 logrotate.conf /etc/logrotate.d/octoport-openrouter
install -m 0644 httpd.conf "$root/httpd.conf"
install -m 0644 octoport-openrouter.service /etc/systemd/system/
umask 077
printf 'OPENROUTER_PROXY_LISTEN=%s\nOPENROUTER_ALLOWED_CLIENTS="%s"\n' \
  "$OPENROUTER_PROXY_LISTEN" "$OPENROUTER_ALLOWED_CLIENTS" > "$root/router.env.new"
mv "$root/router.env.new" "$root/router.env"
systemctl daemon-reload
systemctl enable octoport-openrouter.service
systemctl restart octoport-openrouter.service
