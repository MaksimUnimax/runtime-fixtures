"""Finite manual A/B. Existing Harness owns model/tool/error continuation."""
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from urllib.request import Request, build_opener, ProxyHandler
import argparse
import fcntl
import hashlib
import json
import os
import pwd
import secrets
import shutil
import subprocess
import sys
import time

# This reviewed copy adds raw private receipts; it is not a production transport.
from qa_gateway import Gateway
ROOT = Path('/opt/alisa-dsh-lab/20261110-r1')
sys.path.insert(0, str(ROOT))
from run_smoke import BASE, EVIDENCE, FIREWALL, prepare_rootfs, start_firewall, unit_command, write_job
from run_fixture_cases import shape

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--max-calls', required=True, type=int)
    args = parser.parse_args()
    if not 1 <= args.max_calls <= 64:
        raise ValueError('Finite research allowance must be 1..64')
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    campaign = manifest['campaign']
    if not campaign.isidentifier(): raise ValueError('Invalid campaign')
    output = EVIDENCE / (campaign + '_PRIVATE.json')
    marker = BASE / (campaign + '.started')
    lock = open('/run/lock/alisa-dsh-lab.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if output.exists() or marker.exists(): raise RuntimeError('No replay: inspect prior evidence')
    if not json.loads((EVIDENCE/'smoke-095109-result.json').read_text()).get('passed'):
        raise RuntimeError('Isolation proof missing')
    core = subprocess.check_output(['systemctl','show','alice-market','-p','WorkingDirectory','--value'],text=True).strip()
    sys.path.insert(0,core)
    from http_transport import HTTPTransport
    from model_answer import messages
    import model_input_encoding
    transport = HTTPTransport('/run/credentials/alice-market.service', {}, {}, enabled=True)
    settings_raw = Path('/var/lib/alice-market/answer-settings.json').read_bytes()
    settings = json.loads(settings_raw)
    instruction = '\n'.join(x for x in [settings.get('answer_extra_instruction',''),
                    (ROOT/'answer_instruction.txt').read_text().strip()] if x)
    system_prompt = '\n'.join(x for x in [settings['answer_prompt'],instruction] if x)
    user = pwd.getpwnam('alisa-dsh-lab')
    token = secrets.token_hex(32)
    gateway = Gateway(token,EVIDENCE/(campaign+'_GATEWAY_PRIVATE.json'),
      lambda:transport._credential('deepseek'),maximum=args.max_calls,
      raw_evidence_dir=EVIDENCE/(campaign+'_raw'))
    report = {'campaign':campaign,'state':'PREPARED','synthetic_data':True,
      'manifest_sha256':hashlib.sha256(manifest_bytes).hexdigest(),
      'settings_sha256':hashlib.sha256(settings_raw).hexdigest(),
      'encoding_sha256':hashlib.sha256(Path(model_input_encoding.__file__).read_bytes()).hexdigest(),
      'source_core':core,'max_dispatches':args.max_calls,'cases':[],
      'station_calls':0,'marketplace_calls':0,'selector_calls':0,'production_writes':0,
      'started_utc':datetime.now(timezone.utc).isoformat()}
    def save():
        report['attempts'] = gateway.attempts
        tmp = output.with_suffix('.tmp')
        tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        tmp.replace(output)
    marker.write_text(report['started_utc']+'\n')
    save()
    Thread(target=gateway.serve_forever,daemon=True).start()
    firewall = False
    try:
        start_firewall(user.pw_uid); firewall = True
        for index,case in enumerate(manifest['cases']):
            raw = json.dumps(case['data'],ensure_ascii=False,separators=(',',':'))
            common = case['question']+'\nЗапрошенный период: '+manifest['period']+'.'
            notes = 'Примечания выбранного шаблона:\n'+case['notes']
            entry = {'name':case['name'],'kind':case['kind'],'question':case['question'],
                     'expected':case['expected'],'input_characters':len(raw),
                     'input_bytes':len(raw.encode()),'input_sha256':hashlib.sha256(raw.encode()).hexdigest(),
                     'methods':{}}
            report['cases'].append(entry)
            methods = case.get('methods', ['direct','harness'] if index%2==0 else ['harness','direct'])
            if not methods or any(x not in ('direct','harness') for x in methods) or len(set(methods)) != len(methods):
                raise ValueError('Invalid research method list')
            for method in methods:
                if len(gateway.attempts)>=args.max_calls: raise RuntimeError('Campaign allowance exhausted')
                first = len(gateway.attempts)
                item = {'state':'RUNNING'}; entry['methods'][method]=item; save()
                started = time.monotonic()
                try:
                    if method=='direct':
                        msgs = messages(common,case['data'],instruction,(notes,),settings['answer_prompt'],input_encoding=1)
                        item['encoded_data_characters'] = len(msgs[-1]['content'])
                        item['packing_used'] = model_input_encoding.V1_INSTRUCTION in msgs[-1]['content']
                        body = {'model':'deepseek-flash','messages':msgs,'stream':False,
                                'thinking':{'type':'enabled'},'reasoning_effort':'high','max_tokens':16384}
                        req = Request('http://127.0.0.1:33191/v1/chat/completions',
                          data=json.dumps(body,ensure_ascii=False).encode(),
                          headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
                        with build_opener(ProxyHandler({})).open(req,timeout=200) as res:
                            answer = json.load(res)
                        item.update(answer=answer['choices'][0]['message']['content'],
                                    finish=answer['choices'][0]['finish_reason'],
                                    state='COMPLETE' if answer['choices'][0]['finish_reason']=='stop' else 'INCOMPLETE')
                    else:
                        if shutil.disk_usage('/').free<3*1024**3+128*1024**2:
                            raise RuntimeError('Disk reserve insufficient')
                        name=campaign+'_'+str(index)
                        job=BASE/'jobs'/name; job.mkdir(exist_ok=False);os.chown(job,user.pw_uid,user.pw_gid)
                        unit='alisa-dsh-'+name
                        try:
                            write_job(job/'input.json',raw,user)
                            write_job(job/'local-transport-token',token,user)
                            prompt=(common+' Полные данные находятся в /workspace/input.json. Используй run_code для работы '
                              'с полным файлом и необходимых вычислений. Формат результата программы выбери по задаче: '
                              'сохрани сведения, нужные для ответа на исходный вопрос.\n'+notes+
                              '\nСтруктура документа (value обозначает значение):\n'+
                              json.dumps(shape(case['data']),ensure_ascii=False,separators=(',',':')))
                            write_job(job/'request.json',json.dumps({'session_id':name,'system_prompt':system_prompt,'prompt':prompt},ensure_ascii=False),user)
                            result=subprocess.run(unit_command(job,prepare_rootfs(),unit),capture_output=True,text=True,timeout=200)
                            (EVIDENCE/(name+'-worker.log')).write_text(result.stdout+result.stderr)
                            item['exit_code']=result.returncode
                            if (job/'result.private.json').exists():
                                item['result']=json.loads((job/'result.private.json').read_text())
                                item['answer']=item['result'].get('final_response','')
                            item['state']='COMPLETE' if result.returncode==0 else 'INCOMPLETE'
                            item['input_unchanged']=hashlib.sha256((job/'input.json').read_bytes()).hexdigest()==entry['input_sha256']
                            item['resources']=subprocess.check_output(['systemctl','show',unit,'-p','MemoryPeak','-p','CPUUsageNSec'],text=True)
                        finally:
                            state=subprocess.run(['systemctl','show',unit,'-p','ActiveState','--value'],capture_output=True,text=True).stdout.strip()
                            if state in {'active','activating','deactivating','reloading'}:
                                subprocess.run(['systemctl','stop',unit],check=True)
                                state=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','--value'],text=True).strip()
                            if state in {'active','activating','deactivating','reloading'}:raise RuntimeError('Worker still active')
                            shutil.rmtree(job)
                except Exception as exc:
                    item.update(state='FAILED',error_type=type(exc).__name__)
                    raise
                finally:
                    item['elapsed_seconds']=round(time.monotonic()-started,3)
                    item['attempt_numbers']=[x['number'] for x in gateway.attempts[first:]]
                    save()
                    print(json.dumps({'case':case['name'],'method':method,'state':item['state'],
                         'calls':len(gateway.attempts)-first,'seconds':item['elapsed_seconds']}),flush=True)
                if item['state']!='COMPLETE':raise RuntimeError('Incomplete turn; inspect before continuing')
        report['state']='COMPLETE_AWAITING_QUALITY_REVIEW'
    except Exception as exc:
        report.update(state='STOPPED_INSPECT',error_type=type(exc).__name__)
        raise
    finally:
        save();gateway.shutdown();gateway.server_close()
        if firewall:subprocess.run(['nft','delete','table','inet',FIREWALL],check=True)

if __name__=='__main__':main()
