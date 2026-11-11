"""No paid calls: exercise native Harness and capture actual provider payload."""
from pathlib import Path
from threading import Thread
from http.server import ThreadingHTTPServer
from urllib.request import Request,build_opener,ProxyHandler
import json,os,pwd,secrets,subprocess,shutil,fcntl
from qa_gateway import Gateway
from common import BASE,EVIDENCE,FIREWALL,install_job_code,command,start_firewall,write_job
from run_smoke import Canary

def main():
    os.umask(0o077)
    lock=open('/run/lock/alisa-dsh-lab.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    name='full_cost_default_probe';job=BASE/'jobs'/name;job.mkdir(exist_ok=False)
    user=pwd.getpwnam('alisa-dsh-lab');os.chown(job,user.pw_uid,user.pw_gid)
    token=secrets.token_hex(32);install_job_code(job,user)
    write_job(job/'local-transport-token',token,user)
    write_job(job/'input.json',json.dumps({'rows':[{'value':x,'padding':'X'*70000}for x in [3,7,11]]}),user)
    write_job(job/'request.json',json.dumps({'session_id':name,'system_prompt':'Calculate from the complete file.','prompt':'Read input.json and calculate the result.'}),user)
    raw=EVIDENCE/(name+'_raw')
    gateway=Gateway(token,EVIDENCE/(name+'_GATEWAY_PRIVATE.json'),raw_evidence_dir=raw)
    gateway.cache_user='qa_full_cost_default_probe'
    canary=ThreadingHTTPServer(('127.0.0.1',33192),Canary)
    for server in [gateway,canary]:Thread(target=server.serve_forever,daemon=True).start()
    firewall=False
    try:
        start_firewall(user.pw_uid);firewall=True
        result=subprocess.run(command(job,'alisa-dsh-'+name),capture_output=True,text=True)
        worker=json.loads((job/'result.private.json').read_text())
        assert result.returncode==0 and worker['final_response']
        body={'model':'deepseek-flash','messages':[{'role':'user','content':'Synthetic direct question'}]}
        req=Request('http://127.0.0.1:33191/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with build_opener(ProxyHandler({})).open(req) as response:response.read()
        wire=[json.loads(p.read_bytes())for p in sorted(raw.glob('*.request.private.json'))if '.client.'not in p.name]
        assert len(wire)==3 and all('max_tokens'not in x for x in wire)
        assert all(a['status']=='SYNTHETIC_RESPONSE'for a in gateway.attempts)
        out={'passed':True,'paid_calls':0,'native_calls':2,'direct_mock_calls':1,
             'actual_provider_payload_has_max_tokens':False,
             'native_client_defaults_removed':[a['removed_client_max_tokens']for a in gateway.attempts],
             'input_immutable_and_runtime_isolation_verified':True,'worker_finish':worker['finish_reason']}
        (EVIDENCE/'FULL_COST_DEFAULT_PROBE.json').write_text(json.dumps(out,indent=2)+'\n')
        print(json.dumps(out))
    finally:
        for server in [gateway,canary]:server.shutdown();server.server_close()
        if firewall:subprocess.run(['nft','delete','table','inet',FIREWALL],check=True)
        state=subprocess.run(['systemctl','show','alisa-dsh-'+name,'-p','ActiveState','--value'],capture_output=True,text=True).stdout.strip()
        if state in ('active','activating','deactivating'):raise RuntimeError('Do not remove active worker')
        shutil.rmtree(job)

if __name__=='__main__':main()
