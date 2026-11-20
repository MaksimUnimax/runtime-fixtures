#!/usr/bin/env python3
"""Install an isolated, private native Harness prototype on the authorized Alisa host.

No existing application service, account table, marketplace state or old Harness
release is changed. Code must already be reviewed and installed in --release.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import pwd
import secrets
import subprocess


def write(path, text, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.new')
    temp.write_text(text)
    temp.chmod(mode)
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True)
    parser.add_argument('--public', action='store_true', help='Enable the separate TLS listener after local qualification')
    args = parser.parse_args()
    release = Path(args.release).resolve()
    if os.geteuid() != 0 or not str(release).startswith('/opt/harness-native-lab/releases/'):
        raise SystemExit('Run as root with a dedicated immutable release path')
    for required in ['native/launch.mjs', 'mcp/server.py', 'gateway/server.mjs']:
        if not (release / required).is_file():
            raise SystemExit('Incomplete lab release')
    for user in ['harness-native-lab', 'harness-native-meter']:
        try:
            pwd.getpwnam(user)
        except KeyError:
            subprocess.run(['useradd', '--system', '--home', '/var/lib/' + user, '--shell', '/usr/sbin/nologin', user], check=True)
    for folder, user in [('/var/lib/harness-native-lab', 'harness-native-lab'), ('/var/lib/harness-native-meter', 'harness-native-meter'), ('/srv/harness-native-lab', 'harness-native-lab')]:
        p = Path(folder); p.mkdir(parents=True, exist_ok=True); p.chmod(0o700)
        account = pwd.getpwnam(user); os.chown(p, account.pw_uid, account.pw_gid)
    config = Path('/etc/harness-native-lab')
    config.mkdir(mode=0o700, exist_ok=True); config.chmod(0o700)
    key = config / 'gateway.key'
    if not key.exists():
        write(key, secrets.token_urlsafe(40) + '\n', 0o600)
    credential_dir = '/run/credentials/harness-native-lab.service'
    connectors = {
        'schema': 'harness-lab-connectors/v1', 'scope_id': 'owner-lab', 'revision': 'native-lab-r1',
        'yandex': {'enabled': False, 'credential_file': credential_dir + '/yandex.json', 'max_daily_requests': 20},
        'ozon': {'enabled': True, 'credential_file': credential_dir + '/ozon.json',
                 'core_root': '/opt/alice-market/releases/alisa-coefficient-station-native-485a2034ac0dc36f',
                 'native_runtime_file': credential_dir + '/market-runtime.json',
                 'native_store_id': 'owner-ozon', 'max_daily_requests': 50},
    }
    if not (config / 'connectors.json').exists():
        write(config / 'connectors.json', json.dumps(connectors, ensure_ascii=False, indent=2) + '\n', 0o600)
    common = '''Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
LimitNOFILE=4096
TimeoutStopSec=30
'''
    gateway_unit = f'''[Unit]
Description=Native Harness lab model gateway and actual usage journal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=harness-native-meter
Group=harness-native-meter
WorkingDirectory={release}/gateway
ExecStart=/usr/local/bin/node {release}/gateway/server.mjs
LoadCredential=deepseek.key:/var/lib/alice-lab/secrets/deepseek.key
LoadCredential=gateway.key:/etc/harness-native-lab/gateway.key
Environment=DEEPSEEK_KEY_FILE=/run/credentials/harness-native-model-gateway.service/deepseek.key
Environment=LAB_GATEWAY_KEY_FILE=/run/credentials/harness-native-model-gateway.service/gateway.key
Environment=LAB_USAGE_DIR=/var/lib/harness-native-meter
Environment=LAB_GATEWAY_PORT=18442
Environment=LAB_FX_RUB_PER_USD=82.4529
ReadWritePaths=/var/lib/harness-native-meter
MemoryHigh=192M
MemoryMax=256M
CPUQuota=100%
{common}
[Install]
WantedBy=multi-user.target
'''
    host_unit = f'''[Unit]
Description=Private native Harness agent and real MCP test lab
After=network-online.target harness-native-model-gateway.service
Wants=network-online.target harness-native-model-gateway.service

[Service]
Type=simple
User=harness-native-lab
Group=harness-native-lab
WorkingDirectory=/srv/harness-native-lab
ExecStart=/usr/local/bin/node {release}/native/launch.mjs
LoadCredential=gateway.key:/etc/harness-native-lab/gateway.key
LoadCredential=connectors.json:/etc/harness-native-lab/connectors.json
LoadCredential=ozon.json:/etc/alice-lab/marketplaces/ozon.json
LoadCredential=market-runtime.json:/etc/alice-market/market-runtime.json
Environment=HARNESS_NODE_MODULES=/opt/octoport-harness-api/runtime/node_modules
Environment=HARNESS_LAB_HOME=/var/lib/harness-native-lab/dsh
Environment=HARNESS_LAB_WORKSPACE=/srv/harness-native-lab
Environment=HARNESS_LAB_PORT=18440
Environment=HARNESS_LAB_PUBLIC_URL=https://alisa.octoport.ru:18443
Environment=HARNESS_LAB_GATEWAY_URL=http://127.0.0.1:18442
Environment=HARNESS_LAB_GATEWAY_KEY_FILE={credential_dir}/gateway.key
Environment=HARNESS_LAB_CONNECTORS_FILE={credential_dir}/connectors.json
Environment=HARNESS_LAB_MCP_PYTHON=/opt/harness-native-lab/venv/bin/python
Environment=HARNESS_LAB_MCP_SERVER={release}/mcp/server.py
Environment=HARNESS_LAB_MCP_STATE_DIR=/var/lib/harness-native-lab/mcp
Environment=NODE_OPTIONS=--max-old-space-size=768
ReadWritePaths=/var/lib/harness-native-lab /srv/harness-native-lab
MemoryHigh=1G
MemoryMax=1536M
CPUQuota=150%
{common}
[Install]
WantedBy=multi-user.target
'''
    write('/etc/systemd/system/harness-native-model-gateway.service', gateway_unit)
    write('/etc/systemd/system/harness-native-lab.service', host_unit)
    subprocess.run(['systemd-analyze', 'verify', '/etc/systemd/system/harness-native-model-gateway.service', '/etc/systemd/system/harness-native-lab.service'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', 'harness-native-model-gateway.service', 'harness-native-lab.service'], check=True)
    subprocess.run(['systemctl', 'restart', 'harness-native-model-gateway.service'], check=True)
    subprocess.run(['systemctl', 'restart', 'harness-native-lab.service'], check=True)
    if args.public:
        nginx = '''server {
  listen 18443 ssl;
  server_name alisa.octoport.ru;
  ssl_certificate /etc/letsencrypt/live/alisa-platform-bootstrap/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/alisa-platform-bootstrap/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 5m;
  access_log off;
  add_header Referrer-Policy no-referrer always;
  add_header X-Content-Type-Options nosniff always;
  location / {
    proxy_pass http://127.0.0.1:18440;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 240s;
    proxy_send_timeout 240s;
    proxy_buffering off;
    proxy_cookie_flags ~ secure httponly samesite=strict;
  }
}
'''
        write('/etc/nginx/sites-available/harness-native-lab.conf', nginx)
        link = Path('/etc/nginx/sites-enabled/harness-native-lab.conf')
        if not link.exists():
            link.symlink_to('/etc/nginx/sites-available/harness-native-lab.conf')
        check = subprocess.run(['nginx', '-t'])
        if check.returncode:
            link.unlink(missing_ok=True)
            raise SystemExit('New TLS listener was not enabled: nginx validation failed')
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print(json.dumps({'installed': str(release), 'tls_listener': args.public, 'native_port': 18440, 'model_gateway_port': 18442, 'credentials_printed': False}))


if __name__ == '__main__':
    main()
