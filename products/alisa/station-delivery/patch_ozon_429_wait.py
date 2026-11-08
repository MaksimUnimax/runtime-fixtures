"""Production compatibility patch: retain Ozon HTTP 429 jobs until accepted.

Apply to the no-app-quotas runtime release, then run test_runtime.py before
pointing the systemd service at the new release. No credentials are copied.
"""
from pathlib import Path
import os
import subprocess

BASE = Path('/opt/alice-market/releases/alisa-runtime-no-app-quotas-r1-20261108')
NEW = Path('/opt/alice-market/releases/alisa-runtime-429-wait-r2-20261108')

def replace(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f'unexpected source drift: {path}')
    temp = path.with_name(path.name + '.new')
    temp.write_text(text.replace(old, new))
    os.chmod(temp, path.stat().st_mode)
    os.replace(temp, path)

def main():
    if not NEW.exists():
        subprocess.run(['cp', '-al', str(BASE), str(NEW)], check=True)
    replace(
        NEW / 'engine.py',
        """                # HTTP 429 is a known rejection, unlike a transport timeout.
                # Bound all automatic retries and preserve the exact job identity.
                with self.repo.connection() as c:
                    failures = c.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND http=429', (jid,)).fetchone()[0]
                if failures <= 2:
                    pause = 90 * (2 ** (failures - 1))
                    due = max(exc.retry_at or 0, self.repo.clock() + pause)
                    self.repo.reschedule(jid, owner, until=due)
                else:
                    self.repo.fail(jid, owner, 'HTTP_429_RETRY_EXHAUSTED')""",
        """                # Ozon has rejected this read for now. Keep the same accepted job
                # until the provider allows it; do not silently exhaust retries.
                with self.repo.connection() as c:
                    failures = c.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND http=429', (jid,)).fetchone()[0]
                pause = min(90 * (2 ** min(max(failures - 1, 0), 4)), 900)
                due = max(exc.retry_at or 0, self.repo.clock() + pause)
                self.repo.reschedule(jid, owner, until=due)""",
    )
    replace(
        NEW / 'tests/test_runtime.py',
        """    def test_429_bounded_retries_then_failed(self):
        self.transport.failure=CallError('HTTP_429',status=429)
        self.submit()
        for count,advance in ((1,91),(2,181),(3,0)):
            self.worker.step();self.assertEqual(self.repo.call_count(),count)
            if advance:self.clock.advance(advance)
        self.assertEqual(self.repo.get('A')['state'],'FAILED')
        self.assertEqual(self.repo.get('A')['error'],'HTTP_429_RETRY_EXHAUSTED')""",
        """    def test_429_keeps_same_job_until_provider_accepts(self):
        self.transport.failure=CallError('HTTP_429',status=429)
        original=self.submit()['job_id']
        for count,advance in ((1,91),(2,181),(3,361)):
            self.worker.step();self.assertEqual(self.repo.call_count(),count)
            row=self.repo.get('A');self.assertEqual(row['state'],'QUEUED')
            self.assertEqual(row['id'],original)
            self.assertGreater(row['due'],self.clock())
            self.clock.advance(advance)
        self.transport.failure=None;self.worker.step()
        self.assertEqual(self.repo.get('A')['state'],'READY')""",
    )

if __name__ == '__main__':
    main()
