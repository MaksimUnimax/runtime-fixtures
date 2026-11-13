import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import deploy
class Rollback(unittest.TestCase):
 def test_untouched_and_partially_mutated_dropins_restore_idempotently(self):
  for partial in (False,True):
   with self.subTest(partial=partial),tempfile.TemporaryDirectory()as temp:
    base=Path(temp);backup=base/'backup';drop=base/'unit.d';drop.mkdir();(backup/'dropins').mkdir(parents=True)
    for name in ('one.conf','two.conf'):
     (backup/'dropins'/name).write_text('original '+name);(drop/name).write_text('original '+name)
    if partial:(drop/'one.conf').unlink()
    files=[base/name for name in ('unit','broker','cleanup','station')]
    for p in files:
     b=backup/'files'/str(p).lstrip('/');b.parent.mkdir(parents=True,exist_ok=True);b.write_text('original');p.write_text('modified'if partial else'original')
    with patch.multiple(deploy,BACKUP=backup,DROP=drop,UNIT=files[0],BROKER_UNIT=files[1],CLEANUP_UNIT=files[2],POINTER=base/'pointer'),patch('deploy.command',return_value='active'):
     for _ in range(2):deploy.restore({'station_dropin':str(files[3])})
    self.assertEqual({p.name:p.read_text()for p in drop.iterdir()},{name:'original '+name for name in ('one.conf','two.conf')})
    self.assertTrue(all(p.read_text()=='original'for p in files))
if __name__=='__main__':unittest.main()
