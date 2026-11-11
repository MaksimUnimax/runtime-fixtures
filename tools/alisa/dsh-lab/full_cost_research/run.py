"""Finite manual full-request comparison. No production writes or voice delivery."""
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
from urllib.request import Request, build_opener, ProxyHandler
import argparse, fcntl, hashlib, json, os, pwd, secrets, shutil, subprocess, sys, time

HERE=Path(__file__).resolve().parent
from qa_gateway import Gateway
from common import BASE,EVIDENCE,FIREWALL,start_firewall,write_job,install_job_code,command
ROOT=Path('/opt/alisa-dsh-lab/20261110-r1')
sys.path.insert(0,str(ROOT))
from run_fixture_cases import shape as document_shape

def sha(value):return hashlib.sha256(value).hexdigest()

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('manifest',type=Path);parser.add_argument('--preflight',action='store_true');args=parser.parse_args()
    manifest_bytes=args.manifest.read_bytes();manifest=json.loads(manifest_bytes)
    campaign=manifest['campaign']
    if not campaign.isidentifier():raise ValueError('Invalid campaign')
    sequence_state={}
    for case in manifest['cases']:
        sequence,phase=case['cache_sequence'],case['cache_phase']
        if not sequence.isidentifier() or phase not in {'first','next'}:raise ValueError('Invalid cache sequence')
        if phase=='first' and sequence in sequence_state:raise ValueError('Repeated first query')
        if phase=='next' and sequence_state.get(sequence)!='first':raise ValueError('Next query without unique first query')
        sequence_state[sequence]=phase
    lock=open('/run/lock/alisa-dsh-lab.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    output=EVIDENCE/(campaign+'_PRIVATE.json');marker=BASE/(campaign+'.started')
    if output.exists() or marker.exists():raise RuntimeError('No replay: inspect existing evidence')
    proof=json.loads((EVIDENCE/'FULL_COST_DEFAULT_PROBE.json').read_text())
    if not proof.get('passed') or proof.get('actual_provider_payload_has_max_tokens') is not False:
        raise RuntimeError('Default payload proof missing')
    core=subprocess.check_output(['systemctl','show','alice-market','-p','WorkingDirectory','--value'],text=True).strip()
    sys.path.insert(0,core)
    from http_transport import HTTPTransport
    from model_answer import messages
    import model_input_encoding,template_catalog,template_protocol,selector_policy
    from semantics import Scope,Store
    transport=HTTPTransport('/run/credentials/alice-market.service',{}, {},enabled=True)
    settings_raw=Path('/var/lib/alice-market/answer-settings.json').read_bytes();settings=json.loads(settings_raw)
    policy=json.loads(Path('/etc/alice-market/market-runtime.json').read_text()).get('selector_prompt')
    if policy!={'layout':'catalog_prefix_v2','isolation':'tenant_v1'}:raise RuntimeError('Selector policy changed; review')
    scope=Scope('synthetic_full_cost','qa', (Store('qa_wb','wb','qa_store','qa','qa','RUB'),))
    catalog=template_catalog.discovery(SimpleNamespace(dataset_capabilities=None,table_capabilities=None),scope)
    instruction=settings.get('answer_extra_instruction','')
    system_prompt='\n'.join(x for x in [settings['answer_prompt'],instruction] if x)
    user=pwd.getpwnam('alisa-dsh-lab');token=secrets.token_hex(32)
    gateway_campaign=campaign+'_preflight' if args.preflight else campaign
    gateway=Gateway(token,EVIDENCE/(gateway_campaign+'_GATEWAY_PRIVATE.json'),
                    None if args.preflight else lambda:transport._credential('deepseek'),
                    raw_evidence_dir=EVIDENCE/(gateway_campaign+'_raw'))
    def selector_request(question,namespace):
        return selector_policy.apply({'system':template_protocol.SELECT_SYSTEM,
            'instruction':settings.get('request_planning_prompt',''),
            'context':{'original_question':question,'clarifications':[],'server_date':'2026-11-11',
                'timezone':'Europe/Moscow','allowed_stores':[{'id':'qa_wb','platform':'wb'}],
                'templates':catalog,'input_contract':template_catalog.INPUT_CONTRACT,'temporary_mode':template_catalog.MODE}},policy,namespace)
    if args.preflight:
        Thread(target=gateway.serve_forever,daemon=True).start()
        try:
            body=selector_request(manifest['cases'][0]['question'],'qa_preflight_full_cost')
            gateway.stage='selector';gateway.cache_user=body['_selector_user_id']
            wire=template_protocol.payload('template_select',body)
            req=Request('http://127.0.0.1:33191/v1/chat/completions',data=json.dumps(wire,ensure_ascii=False).encode(),
                        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
            with build_opener(ProxyHandler({})).open(req) as response:response.read()
            actual=json.loads((EVIDENCE/(gateway_campaign+'_raw')/'1.request.private.json').read_bytes())
            assert actual==wire and actual['max_tokens']==6000 and actual['user_id']==body['_selector_user_id']
            proof={'passed':True,'paid_calls':0,'catalog_entries':len(catalog),'selector_wire_matches_production_builder':True,
                   'selector_policy':policy,'selector_max_tokens':6000,'runner_sha256':sha(Path(__file__).read_bytes())}
            (EVIDENCE/'FULL_COST_SELECTOR_PROBE.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
        finally:gateway.shutdown();gateway.server_close()
        return
    report={'campaign':campaign,'state':'PREPARED','synthetic_data':True,'cases':[],
            'manifest_sha256':sha(manifest_bytes),'settings_sha256':sha(settings_raw),
            'selector_policy':policy,'selector_catalog_sha256':sha(json.dumps(catalog,ensure_ascii=False).encode()),
            'source_core':core,'station_calls':0,'marketplace_calls':0,'production_writes':0,
            'qa_answer_output_cap':None,'selector_existing_output_cap':6000,
            'cache_control':'provider user_id namespace: first and subsequent real queries; actual receipts authoritative',
            'started_utc':datetime.now(timezone.utc).isoformat(),
            'sources':{name:sha((HERE/name).read_bytes()) for name in ['run.py','qa_gateway.py','worker.py','harness.patch.yml','common.py']}}
    def save():
        report['attempts']=gateway.attempts
        tmp=output.with_suffix('.tmp');tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');tmp.replace(output)
    def chat(body):
        req=Request('http://127.0.0.1:33191/v1/chat/completions',data=json.dumps(body,ensure_ascii=False).encode(),
                    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
        with build_opener(ProxyHandler({})).open(req,timeout=600) as res:return json.load(res)
    marker.write_text(report['started_utc']+'\n');save()
    Thread(target=gateway.serve_forever,daemon=True).start();firewall=False
    try:
        start_firewall(user.pw_uid);firewall=True
        for index,case in enumerate(manifest['cases']):
            raw=json.dumps(case['data'],ensure_ascii=False,separators=(',',':'))
            question=case['question'];common=question+'\nЗапрошенный период: '+manifest['period']+'.'
            notes='Примечания выбранного шаблона:\n'+case['notes']
            entry={k:case[k] for k in ['name','kind','question','expected','cache_sequence','cache_phase','rows']}
            entry.update(input_characters=len(raw),input_bytes=len(raw.encode()),input_sha256=sha(raw.encode()),methods={})
            report['cases'].append(entry)
            methods=case.get('methods',['direct','harness'] if index%2==0 else ['harness','direct'])
            for method in methods:
                namespace='qa_full_cost_'+campaign+'_'+case['cache_sequence']+'_'+method
                with gateway.lock:
                    if any(a['status'] in {'ADMITTED','DISPATCHED'} for a in gateway.attempts):
                        raise RuntimeError('Previous request still in flight')
                selector_body=selector_request(question,namespace)
                gateway.cache_user=selector_body['_selector_user_id']
                first=len(gateway.attempts);started=time.monotonic()
                item={'state':'RUNNING','cache_namespace_sha256':sha(gateway.cache_user.encode())};entry['methods'][method]=item;save()
                try:
                    gateway.stage='selector';selected=chat(template_protocol.payload('template_select',selector_body))
                    item['selector_seconds']=round(time.monotonic()-started,3)
                    item['selector_finish']=selected['choices'][0]['finish_reason']
                    selection=json.loads(selected['choices'][0]['message']['content']);item['selection']=selection
                    template_catalog.shape(selection)
                    calls=selection['invocations']
                    valid=(item['selector_finish']=='stop' and len(calls)==1 and calls[0]['template_id']=='B06.finance_logistics_cost'
                           and calls[0]['store_id']=='qa_wb' and calls[0]['input']=={
                               'period':{'from':manifest['period'],'to':manifest['period']},'comparison':None,'filters':{},'group_by':'marketplace'})
                    item['selection_correct']=valid
                    if not valid:raise ValueError('Incorrect real selector result; never substitute expected plan')
                    gateway.stage='answer';answer_start=time.monotonic()
                    if method=='direct':
                        msgs=messages(common,case['data'],instruction,(notes,),settings['answer_prompt'],input_encoding=1)
                        item['encoded_data_characters']=len(msgs[-1]['content'])
                        item['packing_used']=model_input_encoding.V1_INSTRUCTION in msgs[-1]['content']
                        result=chat({'model':'deepseek-flash','messages':msgs})
                        item.update(answer=result['choices'][0]['message']['content'],finish=result['choices'][0]['finish_reason'],
                            state='COMPLETE' if result['choices'][0]['finish_reason']=='stop' and result['choices'][0]['message']['content'].strip() else 'INCOMPLETE')
                    elif method=='harness':
                        if shutil.disk_usage('/').free<3*1024**3+128*1024**2:raise RuntimeError('Disk reserve insufficient')
                        name=campaign+'_'+str(index);job=BASE/'jobs'/name
                        job.mkdir(exist_ok=False);os.chown(job,user.pw_uid,user.pw_gid);unit='alisa-dsh-'+name
                        try:
                            write_job(job/'input.json',raw,user);write_job(job/'local-transport-token',token,user)
                            install_job_code(job,user)
                            prompt=(common+' Полные данные находятся в /workspace/input.json. Используй run_code для работы '
                              'с полным файлом и необходимых вычислений. Формат результата программы выбери по задаче: '
                              'сохрани сведения, нужные для ответа на исходный вопрос.\n'+notes+
                              '\nСтруктура документа (value обозначает значение):\n'+
                              json.dumps(document_shape(case['data']),ensure_ascii=False,separators=(',',':')))
                            write_job(job/'request.json',json.dumps({'session_id':name,'system_prompt':system_prompt,'prompt':prompt},ensure_ascii=False),user)
                            result=subprocess.run(command(job,unit),capture_output=True,text=True)
                            (EVIDENCE/(name+'-worker.log')).write_text(result.stdout+result.stderr)
                            item['exit_code']=result.returncode
                            if (job/'result.private.json').exists():
                                item['result']=json.loads((job/'result.private.json').read_text());item['answer']=item['result'].get('final_response','')
                            item['state']='COMPLETE' if result.returncode==0 else 'INCOMPLETE'
                            item['input_unchanged']=sha((job/'input.json').read_bytes())==entry['input_sha256']
                            item['resources']=subprocess.check_output(['systemctl','show',unit,'-p','MemoryPeak','-p','CPUUsageNSec'],text=True)
                        finally:
                            state=subprocess.run(['systemctl','show',unit,'-p','ActiveState','--value'],capture_output=True,text=True).stdout.strip()
                            if state in {'active','activating','deactivating','reloading'}:
                                subprocess.run(['systemctl','stop',unit],check=True)
                                state=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','--value'],text=True).strip()
                            if state in {'active','activating','deactivating','reloading'}:raise RuntimeError('Worker still active')
                            shutil.rmtree(job)
                    else:raise ValueError('Invalid method')
                    item['answer_seconds']=round(time.monotonic()-answer_start,3)
                except Exception as exc:
                    item.update(state='FAILED',error_type=type(exc).__name__,error=str(exc)[:300])
                    raise
                finally:
                    item['elapsed_seconds']=round(time.monotonic()-started,3)
                    item['attempt_numbers']=[x['number'] for x in gateway.attempts[first:]];save()
                    print(json.dumps({'case':case['name'],'method':method,'state':item['state'],
                         'calls':len(gateway.attempts)-first,'seconds':item['elapsed_seconds'],'answer':item.get('answer',''),
                         'expected':entry['expected']},ensure_ascii=False),flush=True)
                if item['state']!='COMPLETE':raise RuntimeError('Incomplete turn; inspect before continuing')
        report['state']='COMPLETE_AWAITING_QUALITY_REVIEW'
    except Exception as exc:
        report.update(state='STOPPED_INSPECT',error_type=type(exc).__name__);raise
    finally:
        save();gateway.shutdown();gateway.server_close()
        if firewall:subprocess.run(['nft','delete','table','inet',FIREWALL],check=True)

if __name__=='__main__':main()
