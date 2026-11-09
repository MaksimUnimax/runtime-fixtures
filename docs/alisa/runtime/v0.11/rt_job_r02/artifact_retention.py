"""Allowlisted private backups/probes only: never source code, keys or projects.
Hourly job; bounded deletions, no symlink/hardlink following, no network.
"""
from __future__ import annotations
import argparse,json,os,stat,time
from pathlib import Path
ROOTS=('/root/alice-lab-evidence','/var/lib/alice-lab/probe-reports')
MAX_AGE=86400
MAX_BYTES=32*1024*1024
MAX_REMOVALS=200
PRIVATE_NAMES={'original-job-private.json','final-private-trace.json'}

def eligible(path,probe=False):
    name=Path(path).name
    return ((name.endswith('.sqlite3') and ('before' in name or 'backup' in name)) or
            name in PRIVATE_NAMES or
            (name.endswith('.json') and (name.startswith(('wb_','ozon_','oct2026_probe_','deepseek_ir_')) or probe)))

def prune(roots=ROOTS,now=None,max_age=MAX_AGE,max_bytes=MAX_BYTES):
    now=time.time() if now is None else now
    candidates=[]
    for raw in roots:
        root=Path(raw)
        if root.is_symlink() or not root.is_dir() or any(p.is_symlink() for p in root.parents):continue
        for base,dirs,files in os.walk(root,followlinks=False):
            dirs[:]=[d for d in dirs if not (Path(base)/d).is_symlink()]
            for name in files:
                p=Path(base)/name
                if not eligible(p,root.name=='probe-reports'):continue
                try:st=p.lstat()
                except FileNotFoundError:continue
                if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1:continue
                candidates.append((st.st_mtime,p,st.st_size,st.st_ino,st.st_dev))
    candidates.sort(key=lambda x:x[0]);total=sum(x[2] for x in candidates)
    before=total;deleted=0;freed=0
    for modified,p,size,ino,dev in candidates:
        # Preserve a new rollback backup even if capacity is temporarily exceeded.
        should_delete=modified<=now-max_age or (total>max_bytes and modified<=now-3600)
        if not should_delete or deleted>=MAX_REMOVALS:continue
        if any(parent.is_symlink() for parent in p.parents):continue
        try:st=p.lstat()
        except FileNotFoundError:continue
        if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or (st.st_ino,st.st_dev,st.st_size)!=(ino,dev,size):continue
        p.unlink();deleted+=1;freed+=size;total-=size
    return {'private_data_bytes_before':before,'private_data_bytes_after':total,
            'deleted_files':deleted,'freed_bytes':freed,'over_budget':total>max_bytes,
            'source_files_touched':False,'network_calls':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--status-file');args=parser.parse_args()
    report=prune();report['utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    if args.status_file:
        p=Path(args.status_file);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2));tmp.chmod(0o600);tmp.replace(p)
    print(json.dumps(report))
