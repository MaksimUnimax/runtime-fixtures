"""Use the existing isolated executor without a research model-output ceiling."""
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parent
ROOT=Path('/opt/alisa-dsh-lab/20261110-r1')
sys.path.insert(0,str(ROOT))
from run_smoke import BASE,EVIDENCE,FIREWALL,prepare_rootfs,start_firewall,write_job,unit_command

def install_job_code(job,user):
    for name in ('worker.py','harness.patch.yml'):
        write_job(job/name,(HERE/name).read_text(),user)

def command(job,unit):
    args=unit_command(job,prepare_rootfs(),unit)
    args=[x.replace('--property=RuntimeMaxSec=180','--property=RuntimeMaxSec=infinity') for x in args]
    for i,value in enumerate(args):
        if value.startswith('--property=BindReadOnlyPaths='):
            args[i]+=' '+str(job/'worker.py')+':/workspace/worker.py '+str(job/'harness.patch.yml')+':/workspace/harness.patch.yml'
    args[-1]='/workspace/worker.py'
    return args
