"""Exercise real shell operations in a disposable filesystem; no live mutations."""
from pathlib import Path
import os
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / 'infra/production/scripts/deploy-octoport-site.sh'
VERIFY = ROOT / 'infra/production/scripts/verify-octoport-site.sh'


class SiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.conf = self.root / 'conf'
        self.conf.mkdir()
        self.apps = self.conf / 'octoport-apps.conf'
        self.apps.write_text('application config before deployment\n')
        self.site = self.conf / 'octoport-site.conf'
        self.site.write_text('site config before deployment\n')
        self.previous = self.root / 'previous'
        self.previous.mkdir()
        self.candidate = self.root / 'candidate'
        self.candidate.mkdir()
        self.current = self.root / 'current'
        self.current.symlink_to(self.previous)

    def run_deploy(self, body):
        setup = '\n'.join([
            'source ' + shlex.quote(str(DEPLOY)),
            'NGINX_CONF_DIR=' + shlex.quote(str(self.conf)),
            'BACKUP_DIR=' + shlex.quote(str(self.root / 'backup')),
            'CURRENT_LINK=' + shlex.quote(str(self.current)),
            'RELEASE_DIR=' + shlex.quote(str(self.candidate)),
            'nginx() { return 0; }',
            'systemctl() { return 0; }',
        ])
        return subprocess.run(['bash', '-c', setup + '\n' + body], text=True, capture_output=True)

    def test_static_source_accepted(self):
        result = self.run_deploy('assert_source')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_historical_combined_ingress_rejected(self):
        bad = self.root / 'old.conf'
        bad.write_text((ROOT / 'infra/production/nginx/octoport-site.conf').read_text() +
                       '\nserver {\n server_name app.octoport.ru;\n return 503 "not deployed";\n}\n')
        result = self.run_deploy('SOURCE_NGINX=' + shlex.quote(str(bad)) + '\nassert_source')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('only three', result.stderr)

    def test_missing_application_config_fails_before_install(self):
        self.apps.unlink()
        result = self.run_deploy('assert_application_ingress\ninstall_live_ingress')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.site.read_text(), 'site config before deployment\n')

    def test_install_preserves_application_config(self):
        result = self.run_deploy('assert_application_ingress\ninstall_live_ingress\nassert_application_ingress_unchanged')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.apps.read_text(), 'application config before deployment\n')
        self.assertEqual(self.site.read_bytes(), (ROOT / 'infra/production/nginx/octoport-site.conf').read_bytes())

    def test_application_change_stops_site_install(self):
        result = self.run_deploy('assert_application_ingress\nprintf changed >"${NGINX_CONF_DIR}/${APPS_NAME}"\ninstall_live_ingress')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('application ingress changed', result.stderr)
        self.assertEqual(self.site.read_text(), 'site config before deployment\n')

    def test_rollback_restores_site_but_preserves_new_application_config(self):
        result = self.run_deploy('''assert_application_ingress
backup_existing_state
printf stale >"${BACKUP_DIR}/${APPS_NAME}"
switch_current_release
install_live_ingress
printf new-application-version >"${NGINX_CONF_DIR}/${APPS_NAME}"
restore_previous_state
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.current.resolve(), self.previous)
        self.assertEqual(self.site.read_text(), 'site config before deployment\n')
        self.assertEqual(self.apps.read_text(), 'new-application-version')

    def test_verification_failure_triggers_real_exit_rollback(self):
        result = self.run_deploy('''assert_application_ingress
backup_existing_state
capture_failure_diagnostics() { :; }
trap on_exit EXIT
switch_current_release
install_live_ingress
fail "simulated post-deploy verification failure"
''')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current.resolve(), self.previous)
        self.assertEqual(self.site.read_text(), 'site config before deployment\n')
        self.assertEqual(self.apps.read_text(), 'application config before deployment\n')

    def run_routes(self, scenario):
        body = '''
MAX_ATTEMPTS=1
RETRY_DELAY=0
http_status() {
  if [[ "$SCENARIO" == portal-down && "$1" == https://app.octoport.ru/ ]]; then
    printf 503
  elif [[ "$1" == */accounts ]]; then
    if [[ "$SCENARIO" == auth-open ]]; then printf 200; else printf 401; fi
  else
    printf 200
  fi
}
curl() {
  local url="${@: -1}"
  case "$url" in
    */health/live) printf '{"status":"live"}';;
    */health/ready)
      if [[ "$SCENARIO" == wrong-health ]]; then printf '{"error":"service_not_deployed"}';
      else printf '{"status":"ready"}'; fi;;
    */accounts)
      if [[ "$SCENARIO" == wrong-auth ]]; then printf '{"error":{"code":"OTHER"}}';
      else printf '{"error":{"code":"AUTH_SESSION_INVALID"}}'; fi;;
    *) return 1;;
  esac
}
check_application_routes
'''
        return subprocess.run(['bash', '-c', 'source ' + shlex.quote(str(VERIFY)) + '\n' + body],
                              env={**os.environ, 'SCENARIO': scenario}, text=True, capture_output=True)

    def test_healthy_routes_and_protected_anonymous_request_pass(self):
        result = self.run_routes('healthy')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_portal_503_is_a_deployment_failure(self):
        result = self.run_routes('portal-down')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('expected 200', result.stderr)

    def test_200_placeholder_is_not_a_healthy_api(self):
        result = self.run_routes('wrong-health')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('invalid health response', result.stderr)

    def test_anonymous_access_must_remain_denied(self):
        for scenario in ['auth-open', 'wrong-auth']:
            with self.subTest(scenario=scenario):
                self.assertNotEqual(self.run_routes(scenario).returncode, 0)


if __name__ == '__main__':
    unittest.main()
