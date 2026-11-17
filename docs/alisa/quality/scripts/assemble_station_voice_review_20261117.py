import ast,hashlib,importlib.util,json,os,shutil,subprocess,tarfile,time
from pathlib import Path
ROOT=Path('/root/alisa-coefficient-station-delivery-20261117-independent')
AUTHOR=Path('/root/alisa-coefficient-station-prepare-20261117')
HEAD='485a2034ac0dc36fea2590666075b54c24b12174'
OUT=ROOT/'candidates'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def emit(name,value):
 p=ROOT/name
 with p.open('x') as f: json.dump(value,f,indent=2,sort_keys=True);f.write('\n')
def reserve():
 s=os.statvfs(ROOT);assert s.f_bavail*s.f_frsize>3*1024**3+150*1024**2,'RESERVE';assert s.f_favail>200000,'INODE_RESERVE'
def service_state():
 units=['alice-market.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-runtime-authority-stage.service','alisa-admin@stage.service','alisa-identity@stage.service','alisa-station.service','alisa-store-check.service','alisa-smtp-sandbox-stage.service']
 result={}
 for u in units:
  s=subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','ActiveState'],text=True)
  result[u]=dict(l.split('=',1)for l in s.splitlines());assert result[u]['ActiveState']=='active',u
 return result
def verify(root,m):
 for n,h in m['files'].items():
  p=root/n;assert not p.is_symlink() and p.is_file() and sha(p)==h,('FILE',str(p))
 for n,target in m.get('links',{}).items():assert (root/n).is_symlink() and str((root/n).readlink())==target,('LINK',n)
def write(p,data,mode=0o644):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(mode)
reserve();assert not OUT.exists(),'CANDIDATES_ALREADY_EXIST'
selected=json.loads((AUTHOR/'SELECTED_VARIANT.json').read_text());assert selected['selected_variant']=='LEGACY_STATION_ONLY' and selected['source_head']==HEAD
prepared=json.loads((AUTHOR/'PREPARED_LEGACY_ONLY.json').read_text());assert sha(AUTHOR/'PREPARED_LEGACY_ONLY.json')==selected['prepared_sha256']
full=json.loads((AUTHOR/'PREPARED.json').read_text())
delta=AUTHOR/'candidate-legacy-only'
assert len(prepared['payload_files'])==14
bases={k:Path(v['root'])for k,v in full['bases'].items()}
manifests={}
before=service_state()
for k,b in bases.items():
 assert sha(b/'manifest.json')==full['bases'][k]['manifest_sha256'];m=json.loads((b/'manifest.json').read_text());verify(b,m);manifests[k]=m
assert Path('/opt/alice-market/releases/current').resolve()==bases['native']
for n,h in prepared['payload_files'].items():
 k,rel=n.split('/',1);assert sha(delta/n)==h['after'];p=bases[k]/rel
 assert (sha(p) if p.is_file() else None)==h['before'],('BASE_MOVED',n)
builder=AUTHOR/'qualified-overlay/build_overlay.py';b=builder.read_bytes()
assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()=="dcb416e7628896f314e6c1e16587bd2a4f58d17b",'BUILDER_SOURCE'
spec=importlib.util.spec_from_file_location('qualified_coefficient_composition',builder);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
generated={'native':mod.native_sources(bases['native']),'station':{**mod.station_sources(bases['station'],delta/'station/parameter_voice_catalog.json'),**mod.ui_sources(bases['station'])}}
for k,files in generated.items():
 for n,s in files.items():assert s.encode()==(delta/k/n).read_bytes(),('COMPOSITION',k,n)
# Read packaged backend source once in physical order; settings keeps the installed R15 prefix.
tar=ROOT/'alisa-485a2034ac0dc36f.tar.gz'
import zipfile
with zipfile.ZipFile(ROOT/'source-artifact-485a2034.zip') as z:
 expected_tar=z.read('alisa-485a2034ac0dc36f.tar.gz.sha256').decode().split()[0]
assert sha(tar)==expected_tar,'NESTED_TAR_HASH'
want={n.split('/',1)[1]:n for n in prepared['payload_files'] if n.startswith('platform/')}
with tarfile.open(tar) as t:
 members=t.getmembers();pack=json.load(t.extractfile(next(x for x in members if x.name=='alisa-485a2034ac0dc36f/manifest.json')))
 assert pack['source_sha']==HEAD
 indexed={x.name.removeprefix('alisa-485a2034ac0dc36f/'):x for x in members}
 for n in sorted(want,key=lambda n:indexed[n].offset_data):
  data=t.extractfile(indexed[n]).read();assert hashlib.sha256(data).hexdigest()==pack['files'][n],('PACKAGED_HASH',n)
  candidate=(delta/want[n]).read_bytes()
  if n.endswith('/config/settings.py'):
   old=(bases['platform']/n).read_bytes();assert candidate.startswith(old);suffix=candidate[len(old):];assert data.endswith(suffix) and b'ALISA_OWNER_PARAMETER_VOICE_ENABLED' in suffix
  else:assert candidate==data,('PACKAGED_SOURCE',n)
emit('ASSEMBLY_INTENT.json',{'source_head':HEAD,'scope':'private full-release candidates; no live selector/config/database writes','bases':full['bases'],'service_generations':before,'selected_variant_sha256':sha(AUTHOR/'SELECTED_VARIANT.json')})
OUT.mkdir(mode=0o700)
receipts={}
for k,base in bases.items():
 dest=OUT/('alisa-coefficient-station-'+k+'-'+HEAD[:16]);dest.mkdir(mode=0o755)
 m=json.loads(json.dumps(manifests[k]))
 for n in m['files']:
  p=dest/n;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(base/n,p)
 for n,target in m.get('links',{}).items():
  p=dest/n;p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(target)
 venv_target=None
 if k=='platform':
  assert (base/'.venv').is_symlink();venv_target=str((base/'.venv').readlink());(dest/'.venv').symlink_to(venv_target)
 changed={}
 for name,h in prepared['payload_files'].items():
  kind,n=name.split('/',1)
  if kind!=k:continue
  write(dest/n,(delta/name).read_bytes());m['files'][n]=h['after'];changed[n]=h
 if k=='native':
  core=json.loads((dest/'CURRENT_CORE_MANIFEST.json').read_text())
  for n,h in changed.items():core['files'][n]=h['after']
  core['coefficient_station_source']=HEAD
  write(dest/'CURRENT_CORE_MANIFEST.json',(json.dumps(core,sort_keys=True,indent=2)+'\n').encode())
  m['files']['CURRENT_CORE_MANIFEST.json']=sha(dest/'CURRENT_CORE_MANIFEST.json')
  assert core['files']=={n:h for n,h in m['files'].items()if n!='CURRENT_CORE_MANIFEST.json'}
  changed['CURRENT_CORE_MANIFEST.json']={'before':manifests[k]['files']['CURRENT_CORE_MANIFEST.json'],'after':m['files']['CURRENT_CORE_MANIFEST.json']}
 old_source=m.get('source_sha',m.get('source_commit'))
 m.update(artifact_id=dest.name,base_release=base.name,base_manifest_sha256=full['bases'][k]['manifest_sha256'],coefficient_station_source=HEAD,coefficient_station_scope='legacy_only_no_schema_change',acceptance='PREPARED_NOT_INSTALLED')
 if k in ('native','station'):m['source_commit']=HEAD
 if k=='platform':
  m['backend_source_sha']=HEAD;m['backend_overlay']='legacy-station-coefficient-voice-v1';m['backend_qualified_tar_sha256']=sha(tar)
 write(dest/'manifest.json',(json.dumps(m,sort_keys=True,indent=2)+'\n').encode())
 verify(dest,m)
 for n in changed:
  if n.endswith('.py'):ast.parse((dest/n).read_text(),filename=n)
  if n.endswith('.json'):json.loads((dest/n).read_text())
 for n,h in manifests[k]['files'].items():
  if n not in changed:assert m['files'][n]==h and sha(dest/n)==h
 if k=='platform':
  assert m['migrations']==manifests[k]['migrations'];assert not (dest/'services/platform/src/alisa_platform/alice_link/migrations/0002_parameter_voice_consent.py').exists()
  assert str((dest/'.venv').readlink())==venv_target
 receipts[k]={'root':str(dest),'manifest_sha256':sha(dest/'manifest.json'),'files':len(m['files']),'links':len(m.get('links',{})),'changed_files':changed,'retained_source_sha':old_source,'shared_venv_target':venv_target}
 # Read-only private candidates. No source hard links to installed releases.
 for dirpath,dirs,files in os.walk(dest,followlinks=False):
  for n in files:
   p=Path(dirpath)/n
   if not p.is_symlink():p.chmod(0o555 if p.stat().st_mode&0o111 else 0o444)
  Path(dirpath).chmod(0o555)
 verify(base,manifests[k])
after=service_state();assert before==after,'LIVE_GENERATION_MOVED'
reserve()
emit('CANDIDATES_PREPARED.json',{'status':'THREE_PRIVATE_CANDIDATES_VERIFIED_NOT_INSTALLED','source_head':HEAD,'variant':'LEGACY_STATION_ONLY','candidates':receipts,'service_generations_unchanged':True,'migrations_added':False,'global_flag_changed':False,'owner_consent_changed':False,'live_coefficient_changed':False,'next':'author qualifies assembled-release activation and rollback; independent delivery review before switching'})
print(json.dumps({'status':'PASS','source_head':HEAD,'candidates':{k:{f:v[f]for f in ('root','manifest_sha256','files','links')}for k,v in receipts.items()},'live_generations_unchanged':before==after}))
