"""Prepare immutable R5 components on the pinned AL-S11 candidate, no activation.

The parallel agent retains ownership of AL-S11 switching. This builder never
changes selectors, service configuration, database rows or source manifests.
"""
from pathlib import Path
import hashlib,json,os,shutil,sys
SOURCE='1d572aebf6b05b88ae5c233ae4313284add03e45'
ROOT=Path('/root/alisa-parameters-install-20261114-r5')
PAYLOAD=Path('/dev/shm/alisa-parameters-release-1d572aeb/payload')
PLATFORM=Path('/opt/alisa-platform/stage/releases/alisa-question-catalog-d4eb0ccf798fbb45')
NATIVE=Path('/opt/alice-market/releases/alisa-question-catalog-d4eb0ccf798fbb45')
WEB=Path('/opt/alisa-platform/stage/releases/alisa-cabinet-catalog-d4eb0ccf798fbb45')
TARGETS=[PLATFORM.parent/('alisa-parameters-'+SOURCE[:16]),NATIVE.parent/('alisa-parameters-'+SOURCE[:16]),WEB.parent/('alisa-cabinet-parameters-'+SOURCE[:16])]
BASE_HASHES=['f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579','b4d7a9ea7208eeff3f14c343ed7125cd4bce7c13b6e9d82ca55ef984824da33b','0cc61e61aa2a682b9aee06130ad332e5957ed7ba0a052fe182f6403007822f3c']
PAYLOAD_HASH='75260a0f546195f5366193045346ab7bbc4fed2ecfc8bb7bcdee5443da843c8a'

def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def safe(n):return type(n)is str and str(Path(n))==n and not Path(n).is_absolute()and '..'not in Path(n).parts

def verify(root):
 m=json.loads((root/'manifest.json').read_text())
 for n,h in m['files'].items():need(safe(n)and not(root/n).is_symlink()and(root/n).is_file()and sha(root/n)==h,'MANIFEST_FILE')
 for n,d in m.get('links',{}).items():need(safe(n)and(root/n).is_symlink()and os.readlink(root/n)==d and(root/n).resolve().is_relative_to(root),'MANIFEST_LINK')
 return m

def write(p,data,mode=0o644):
 p.parent.mkdir(parents=True,exist_ok=True);need(not p.exists()and not p.is_symlink(),'PATH_EXISTS')
 with p.open('xb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 p.chmod(mode)

def prepare():
 need(os.geteuid()==0,'ROOT_REQUIRED');ROOT.mkdir(mode=0o700,exist_ok=True)
 need(not(ROOT/'PREPARED.json').exists()and not any(p.exists()for p in TARGETS),'ALREADY_PREPARED')
 need(sha(PAYLOAD/'PAYLOAD_MANIFEST.json')==PAYLOAD_HASH,'PAYLOAD_MANIFEST_CHANGED')
 p=json.loads((PAYLOAD/'PAYLOAD_MANIFEST.json').read_text());need(p['source']==SOURCE,'SOURCE')
 for n,h in p['files'].items():need(safe(n)and(PAYLOAD/n).is_file()and not(PAYLOAD/n).is_symlink()and sha(PAYLOAD/n)==h,'PAYLOAD_FILE')
 for n,t in p['links'].items():need((PAYLOAD/n).is_symlink()and os.readlink(PAYLOAD/n)==t and(PAYLOAD/n).resolve().is_relative_to(PAYLOAD),'PAYLOAD_LINK')
 old=[]
 for root,digest in zip([PLATFORM,NATIVE,WEB],BASE_HASHES):need(sha(root/'manifest.json')==digest,'S11_BASE_CHANGED');old.append(verify(root))
 s11=json.loads(Path('/root/alisa-question-catalog-install-20261114/PLAN.json').read_text())
 need(s11['source']=='d4eb0ccf798fbb45438f9742222425507867a99a','S11_SOURCE')
 for kind,index in [('platform',0),('native',1)]:
  for n,h in p['expected_base_'+kind].items():
   actual=old[index]['files'].get(n)
   need(actual==h or n in s11[kind+'_files']and actual==s11[kind+'_files'][n] or kind=='native'and n=='template_protocol.py'and actual=='c5858e44eb797abf1f102c81ca7a35d747fc06162dbbb96016c59d9c708c6969'and h=='0c3f913288cf019349992d3ab36e2d64aeaa214eb2dbb28644e776b80e645965','BASE_FILE_CHANGED:'+n)
 need(p['locks']==old[0]['locks']==old[2]['locks'],'LOCKFILES_CHANGED')
 extra=json.loads((ROOT/'SUPPLEMENT.json').read_text());need(extra['source']==SOURCE and set(extra['files'])=={'question_catalog_extension.py','template_protocol.py'},'SUPPLEMENT_SCOPE')
 need(all(sha(ROOT/n)==h for n,h in extra['files'].items()),'SUPPLEMENT_CHANGED')
 need((ROOT/'template_protocol.py').read_bytes().startswith((NATIVE/'template_protocol.py').read_bytes()),'LIVE_PROTOCOL_NOT_PRESERVED')
 new=json.loads(json.dumps(old));updated=[]
 for kind,index in [('platform',0),('native',1),('web',2)]:
  changes={n[len(kind)+1:]:h for n,h in p['files'].items()if n.startswith(kind+'/')}
  new[index]['files']=changes if kind=='web'else{**new[index]['files'],**changes}
  if kind=='web':new[index]['links']={n[4:]:t for n,t in p['links'].items()if n.startswith('web/')}
  new[index].update(artifact_id=TARGETS[index].name,parameter_source=SOURCE,base_release=[PLATFORM,NATIVE,WEB][index].name,base_manifest_sha256=BASE_HASHES[index],preserved_catalog_source=s11['source'])
  new[index]['source_commit'if kind=='native'else'source_sha']=SOURCE
  updated.append(changes)
 mig='services/platform/src/alisa_platform/owner_data/migrations/0002_current_parameter_only.py'
 need({n for n in updated[0]if'/migrations/'in n}=={mig},'MIGRATION_SCOPE')
 new[0]['migrations'][mig]=updated[0][mig];new[0]['schema_compatibility']['platform_owner_data']=['0001_initial','0002_current_parameter_only']
 new[1]['files'].update(extra['files']);updated[1].update(extra['files'])
 core=json.loads((NATIVE/'CURRENT_CORE_MANIFEST.json').read_text());need(core['files']=={n:h for n,h in old[1]['files'].items()if n!='CURRENT_CORE_MANIFEST.json'},'CORE_MANIFEST_MISMATCH')
 core['files'].update(updated[1]);core['parameter_source']=SOURCE
 core_raw=(json.dumps(core,indent=2)+'\n').encode();new[1]['files']['CURRENT_CORE_MANIFEST.json']=hashlib.sha256(core_raw).hexdigest()
 changed_bytes=sum((PAYLOAD/k/n).stat().st_size for k,i in [('platform',0),('native',1),('web',2)]for n in updated[i]if old[i]['files'].get(n)!=updated[i][n]and(PAYLOAD/k/n).is_file())
 dirs=sum(len({str(q)for n in m['files']for q in Path(n).parents})for m in new);extra_budget=changed_bytes+dirs*8192+sum(len(m['files'])for m in new)*512+8*1024**2
 stat=os.statvfs('/opt');need(stat.f_bavail*stat.f_frsize-extra_budget>3*1024**3 and stat.f_favail>200000+sum(len(m['files'])for m in new)+dirs,'RESOURCE_RESERVE')
 created=[]
 try:
  for kind,base,target,previous,candidate in zip(['platform','native','web'],[PLATFORM,NATIVE,WEB],TARGETS,old,new):
   target.mkdir(mode=0o755);created.append(target)
   for n,h in candidate['files'].items():
    dest=target/n;dest.parent.mkdir(parents=True,exist_ok=True)
    if previous['files'].get(n)==h:os.link(base/n,dest)
    elif kind=='native'and n=='CURRENT_CORE_MANIFEST.json':write(dest,core_raw)
    elif kind=='native'and n in extra['files']:write(dest,(ROOT/n).read_bytes())
    else:write(dest,(PAYLOAD/kind/n).read_bytes())
   for n,link in candidate.get('links',{}).items():
    dest=target/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.symlink_to(link)
   if kind in('platform','web'):(target/'.venv').symlink_to((base/'.venv').resolve(),target_is_directory=True)
   write(target/'manifest.json',(json.dumps(candidate,indent=2)+'\n').encode());verify(target)
  receipt={'source':SOURCE,'status':'PREPARED_NOT_ACTIVATED','bases':{str(b):h for b,h in zip([PLATFORM,NATIVE,WEB],BASE_HASHES)},'manifests':{str(t):sha(t/'manifest.json')for t in TARGETS},'budget_bytes':extra_budget,'services_changed':False,'database_changed':False,'requires_active_s11_before_switch':True,'supplement_sha256':extra['files']['question_catalog_extension.py']}
  write(ROOT/'PREPARED.json',(json.dumps(receipt,indent=2)+'\n').encode(),0o600);print(json.dumps(receipt,indent=2))
 except BaseException:
  for target in reversed(created):
   if target.exists():shutil.rmtree(target)
  raise

if __name__=='__main__':prepare()
