#!/usr/bin/env python3
"""Publish only the checked v0.5 documentation to branch alisa using normal Git.
Default is offline dry-run. Requires an authenticated Git installation for --push.
Never uses force, modifies existing worktrees, or embeds credentials.
"""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, subprocess, sys
from pathlib import Path
sys.dont_write_bytecode=True
from verify_manifest import verify
REPOSITORY='https://github.com/MaksimUnimax/runtime-fixtures.git'
BRANCH='alisa'
TARGET='docs/alisa/service-platform/v0.5'

def git(args:list[str],cwd:Path|None=None, capture:bool=True)->str:
    proc=subprocess.run(['git',*args],cwd=cwd,text=True,capture_output=capture,
                        env={**os.environ,'GIT_TERMINAL_PROMPT':'1'},check=False)
    if proc.returncode:
        # Raw provider errors can include private authentication details.
        raise RuntimeError('Git operation failed: '+args[0]+'; review locally without publishing credentials.')
    return (proc.stdout or '').strip()

def main()->int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--clone-dir',required=True,type=Path,help='New empty/nonexistent directory, never an existing worktree')
    ap.add_argument('--execute',action='store_true',help='Clone, copy and commit; without this flag only validates local package')
    ap.add_argument('--push',action='store_true',help='Also normal-push to alisa; requires --execute')
    ap.add_argument('--receipt',type=Path,help='Receipt path outside the package and clone')
    args=ap.parse_args();root=Path(__file__).resolve().parents[1]
    errors=verify(root)
    if errors:raise RuntimeError('Package verification failed: '+'; '.join(errors[:8]))
    if args.push and not args.execute:raise RuntimeError('--push requires --execute')
    clone=args.clone_dir.expanduser().resolve()
    if clone==root or clone.is_relative_to(root) or root.is_relative_to(clone):raise RuntimeError('Clone must be separate from the package')
    if clone.exists():raise RuntimeError('Clone directory already exists; existing worktrees are never changed')
    if args.receipt:
        receipt=args.receipt.expanduser().resolve()
        if receipt.is_relative_to(root) or receipt.is_relative_to(clone):raise RuntimeError('Receipt must be outside package and clone')
        if receipt.exists():raise RuntimeError('Receipt already exists; choose a new name')
    manifest_hash=hashlib.sha256((root/'MANIFEST.json').read_bytes()).hexdigest()
    plan={'mode':'EXECUTE' if args.execute else 'OFFLINE_DRY_RUN','repository':REPOSITORY,'branch':BRANCH,
          'target':TARGET,'package_manifest_sha256':manifest_hash,'network_requested':args.execute,'push_requested':args.push}
    print(json.dumps(plan,ensure_ascii=False,indent=2))
    if not args.execute:return 0
    if shutil.which('git') is None:raise RuntimeError('Git is not installed')
    # Check configured author before mutating anything. No guessed identity.
    for key in ['user.name','user.email']:
        if not git(['config','--get',key]):raise RuntimeError('Configure Git '+key+' locally first')
    clone.parent.mkdir(parents=True,exist_ok=True)
    git(['clone','--single-branch','--branch',BRANCH,REPOSITORY,str(clone)],capture=True)
    base=git(['rev-parse','HEAD'],clone)
    if git(['status','--porcelain'],clone):raise RuntimeError('Unexpected non-clean new clone')
    dest=clone/TARGET
    if dest.exists():raise RuntimeError('Target version already exists; compare manually, do not overwrite it')
    shutil.copytree(root,dest)
    if verify(dest):raise RuntimeError('Copied package differs from manifest')
    git(['add','--',TARGET],clone)
    names=git(['diff','--cached','--name-only','-z'],clone).split('\0')
    names=[x for x in names if x]
    if not names or any(not x.startswith(TARGET+'/') for x in names):raise RuntimeError('Staged diff exceeds documentation-only scope')
    git(['commit','-m','docs(alisa): add v0.5 complete implementation handoff and executable foundation gate'],clone)
    commit=git(['rev-parse','HEAD'],clone)
    result={'status':'COMMITTED_LOCALLY_NOT_PUSHED','base_commit':base,'commit':commit,
            'manifest_sha256':manifest_hash,'target':TARGET,'files':len(names)}
    if args.push:
        git(['fetch','origin',BRANCH],clone)
        if git(['rev-parse','FETCH_HEAD'],clone)!=base:
            raise RuntimeError('Remote alisa moved. Local commit is preserved; no push/force/rebase performed. Review a new base.')
        git(['push','origin','HEAD:refs/heads/'+BRANCH],clone)
        git(['fetch','origin',BRANCH],clone)
        remote=git(['rev-parse','FETCH_HEAD'],clone)
        # A concurrent fast-forward is fine only if it retains this commit and exact package bytes.
        git(['merge-base','--is-ancestor',commit,remote],clone)
        expected=git(['rev-parse',f'{commit}:{TARGET}'],clone)
        observed=git(['rev-parse',f'{remote}:{TARGET}'],clone)
        if observed!=expected:raise RuntimeError('Remote package changed; publication is not verified')
        result.update(status='PUSHED_AND_VERIFIED',verified_remote_head=remote,
                      url=f'https://github.com/MaksimUnimax/runtime-fixtures/tree/{commit}/{TARGET}')
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if args.receipt:args.receipt.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except (RuntimeError,OSError,ValueError) as exc:
        print('STOP: '+str(exc),file=sys.stderr);sys.exit(1)
