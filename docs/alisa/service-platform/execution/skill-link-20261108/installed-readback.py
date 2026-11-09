"""Finite installed readback: private configuration stays on the host."""
import importlib.util
import json
import os
from pathlib import Path as P
import stat
import base64
import subprocess
import sys

sys.dont_write_bytecode=True
os.umask(0o077)
D=P('/var/lib/alisa-platform/stage/rollout-backups/skill-link-20261109')
spec=importlib.util.spec_from_file_location('reviewed_activation',D/'activate-b37c6b9f.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
p=json.loads((D/'activation.private.json').read_text())
before=p['before']
after=m.snapshot()
runtime=m.config(P('/etc/alisa-platform/stage/platform.env'))
alice=m.config(m.E)
native=m.config(P('/etc/alice-lab/lab.env'))
env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1',**runtime}
DB=r'''
import json,os,psycopg
with psycopg.connect(dbname=os.environ['ALISA_DB_NAME'],user=os.environ['ALISA_DB_USER'],
 password=os.environ['ALISA_DB_PASSWORD'],host=os.environ['ALISA_DB_HOST'],port=os.environ['ALISA_DB_PORT'],
 connect_timeout=3,options='-c statement_timeout=5000 -c default_transaction_read_only=on')as conn:
 with conn.cursor()as c:
  c.execute("SELECT app,name FROM django_migrations WHERE app='alice_link'");migrations=c.fetchall()
  c.execute('SELECT count(*) FROM accounts_customer');customers=c.fetchone()[0]
  c.execute('SELECT count(*) FROM accounts_tenant');tenants=c.fetchone()[0]
  tables={}
  for n in ['alice_link_alicelink','alice_link_authorizationrequest','alice_link_authorizationcode','alice_link_tokenfamily']:
   rights={}
   for right in ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']:
    c.execute('SELECT has_table_privilege(current_user,%s,%s)',[n,right]);rights[right]=c.fetchone()[0]
   c.execute("SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=current_user::regrole::oid THEN 'RUNTIME' ELSE 'OTHER' END,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace s ON c.relnamespace=s.oid CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a WHERE s.nspname='public' AND c.relname=%s ORDER BY 1,2",[n]);acl=c.fetchall()
   c.execute("SELECT conname,contype FROM pg_constraint WHERE conrelid=%s::regclass ORDER BY conname",[n]);constraints=c.fetchall()
   c.execute('SELECT count(*) FROM '+n);rows=c.fetchone()[0]
   tables[n]={'runtime_privileges':rights,'acl':acl,'constraints':constraints,'rows':rows}
print(json.dumps({'migrations':migrations,'customers':customers,'tenants':tenants,'tables':tables}))
'''
db=json.loads(m.cmd([str(m.T/'.venv/bin/python'),'-B','-c',DB],20,env))
s=m.E.lstat()
checks={
 'original_environments_unchanged':after['environments']==before['environments'],
 'protected_identity_admin_unchanged':after['protected']==before['protected']and all(after['profiles'][u]==before['profiles'][u]for u in m.PROTECTED),
 'only_web_pointer_changed':all(after['pointers'][n]==v for n,v in before['pointers'].items()if n!='web-current'),
 'web_pointer_uses_qualified_release':(m.B/'web-current').resolve()==m.T,
 'private_skill_config_root_0600':stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_mode&0o777==0o600,
 'exact_skill_config_values':alice==p['alice']and alice['ALISA_ALICE_LINK_ENABLED']=='1'and all(native[k]==alice[v]for k,v in [('LAB_OAUTH_CLIENT_ID','ALISA_ALICE_CLIENT_ID'),('LAB_OAUTH_CLIENT_SECRET','ALISA_ALICE_CLIENT_SECRET'),('ALICE_SKILL_ID','ALISA_ALICE_SKILL_ID')])and len(base64.urlsafe_b64decode(alice['ALISA_ALICE_DATA_KEYS']))==32,
 'exact_migration_installed':db['migrations']==[['alice_link','0001_initial']],
 'customer_and_tenant_counts_preserved':all(db[k]==p['database_before'][k]for k in ['customers','tenants']),
 'runtime_dml_only_no_other_grants':all(all(v['runtime_privileges'][k]for k in ['SELECT','INSERT','UPDATE','DELETE'])and not any(v['runtime_privileges'][k]for k in ['TRUNCATE','REFERENCES','TRIGGER'])and all(role in {'OWNER','RUNTIME'}and (role=='OWNER'or not grantable)for role,right,grantable in v['acl'])for v in db['tables'].values()),
 'disk_floor':os.statvfs('/').f_bavail*os.statvfs('/').f_frsize>=m.FLOOR,
}
timer=m.cmd(['systemctl','show','alisa-account-cleanup@stage.timer','-p','ActiveState,Unit,TimersMonotonic,TimersCalendar'])
checks['existing_cleanup_timer_active']='ActiveState=active'in timer and 'Unit=alisa-account-cleanup@stage.service'in timer
profiles={u:m.profile(u)for u in m.UNITS}
checks['own_loaded_dropins']=all(str(m.DROPS[u])in value for u,value in profiles.items())
for u in m.UNITS[1:]:
 checks['effective_target_'+u]=m.cmd(['systemctl','show',u,'-p','WorkingDirectory','--value'])==str(m.T)and str(m.T/'.venv/bin/python')+' '+str(m.T/'infra/launch.py')in profiles[u]and str(m.E)in profiles[u]
types={'alice_link_alicelink':{'c':2,'f':2,'p':1,'u':1},'alice_link_authorizationrequest':{'f':1,'p':1,'u':1},'alice_link_authorizationcode':{'c':1,'f':1,'p':1},'alice_link_tokenfamily':{'c':1,'f':1,'p':1,'u':2}}
checks['expected_constraints']=all({t:sum(kind==t for _,kind in v['constraints'])for t in set(kind for _,kind in v['constraints'])}==types[n]for n,v in db['tables'].items())
native_after={u:m.identity(u)for u in m.NATIVE}
report={'status':'PASS'if all(checks.values())else'REVIEW_REQUIRED','source_sha':m.SOURCE,
 'release':m.T.name,'checks':checks,'database':db,'cleanup_timer':timer,'effective_profiles':profiles,
 'native_profiles_changed_by_parallel_work':[u for u in m.NATIVE if after['native'][u]!=before['native'][u]],
 'native_identities_observed_after':native_after,'native_restart_requested':False,
 'claim_limits':{'native_identity_comparison':'PRE_CUTOVER_INVOCATIONS_NOT_CAPTURED; NO_NATIVE_RESTART_IN_EXACT_REVIEWED_ACTIVATION','timer_cadence_comparison':'CURRENT_CADENCE_OBSERVED; BEFORE_CADENCE_NOT_CAPTURED'},
 'protected_identities':after['protected'],'free_bytes':os.statvfs('/').f_bavail*os.statvfs('/').f_frsize,
 'real_yandex_broker':'NOT_RUN'}
m.fresh(D/'installed-readback.json',json.dumps(report,indent=2).encode())
print(json.dumps(report))
sys.exit(0 if report['status']=='PASS'else 1)
