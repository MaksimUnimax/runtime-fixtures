"""Use the existing scoped migration identity; never print private settings."""
from pathlib import Path
import hashlib,importlib.util,json,os,sys
ROOT=Path(__file__).resolve().parent
APP=Path('/opt/alisa-platform/stage/releases/alisa-parameters-1d572aebf6b05b88')
def require(ok,code):
 if not ok:raise RuntimeError(code)

def main():
 require(os.geteuid()==0 and sys.argv[1:]in [['--state'],['--check'],['--apply']],'ARGUMENTS')
 p=Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a/migrate.py')
 require(hashlib.sha256(p.read_bytes()).hexdigest()=='d99b391ec428e23a4c41f106828887d43b501fbf892f9954cd65b9a92dd59e78','CONFIG_HELPER_CHANGED')
 spec=importlib.util.spec_from_file_location('existing_migration_config',p);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old);old.APP=APP;old.config()
 guard=ROOT/'migration_guard.py';require(hashlib.sha256(guard.read_bytes()).hexdigest()=='1d8e21edee69499c842f07df08e4de721d3e2571e9f8bc8194a00edd282b4efd','MIGRATION_GUARD_CHANGED')
 import django
 django.setup()
 from django.db import connection
 try:
  if sys.argv[1]=='--state':
   from alisa_platform.queries.models import Query
   from django.utils import timezone
   with connection.cursor()as c:c.execute('SET default_transaction_read_only=on')
   result={'active_web_queries':Query.objects.filter(state__in=['UNKNOWN','QUEUED','RUNNING','NEEDS_CLARIFICATION'],expires_at__gt=timezone.now()).count(),'readonly':True}
  else:
   import migration_guard
   result=migration_guard.run(connection,'alisa_stage_platform_runtime',apply=sys.argv[1]=='--apply')
   (ROOT/('MIGRATED.json'if sys.argv[1]=='--apply'else'MIGRATION_CHECK.json')).write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps(result))
 finally:connection.close()
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(json.dumps({'status':'BLOCKED','code':str(e)if type(e)is RuntimeError else type(e).__name__}));raise SystemExit(1)
