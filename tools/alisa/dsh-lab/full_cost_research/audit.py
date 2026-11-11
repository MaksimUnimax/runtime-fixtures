"""Reconcile every actual provider receipt; do not count reasoning twice."""
from pathlib import Path
from decimal import Decimal
import hashlib,json,sys
HERE=Path(__file__).resolve().parent
sys.path.insert(0,'/var/lib/alisa-dsh-lab/research_20261111')
from accounting import quote
sys.path.insert(0,str(HERE))
from qa_gateway import receipts
E=Path('/root/alice-lab-evidence/dsh-lab-20261110')
def sha(b):return hashlib.sha256(b).hexdigest()

def main():
    campaigns=sys.argv[1:];result={'campaigns':campaigns,'cases':[],'attempts':[],
        'price_basis':'Actual provider usage at dated tariff and CBR FX; not invoice reconciliation',
        'prior_research_calls':65,'prior_research_rub':'5.8259652172524',
        'marketplace_calls':0,'voice_calls':0,'production_writes':0}
    ids=set();total=Decimal(0);calls=0;all_assigned=[]
    for campaign in campaigns:
        d=json.loads((E/(campaign+'_PRIVATE.json')).read_text())
        g=json.loads((E/(campaign+'_GATEWAY_PRIVATE.json')).read_text())
        assert d['attempts']==g['attempts']
        raw=E/(campaign+'_raw');quotes={};attempts={a['number']:a for a in d['attempts']}
        for a in d['attempts']:
            n=a['number'];req=(raw/(str(n)+'.request.private.json')).read_bytes()
            res=(raw/(str(n)+'.response.private.bin')).read_bytes()
            client=(raw/(str(n)+'.client.request.private.json')).read_bytes()
            assert sha(req)==a['request_sha256'] and sha(res)==a['response_sha256'] and sha(client)==a['client_request_sha256']
            receipt=receipts(res,a['path']);assert receipt==a['receipt']
            assert receipt['id'] not in ids;ids.add(receipt['id'])
            body=json.loads(req)
            assert body['model']=='deepseek-flash'
            if a['stage']=='selector':assert body['max_tokens']==6000 and body['thinking']['type']=='disabled'
            else:assert 'max_tokens' not in body
            namespace=body['metadata']['user_id'] if a['path'].endswith('/messages') else body['user_id']
            assert sha(namespace.encode())==a['cache_namespace_sha256']
            q=quote(a);assert q['cost'] is not None and q['boundary_ambiguous'] is False
            quotes[n]=q;total+=Decimal(q['rub']);calls+=1
            result['attempts'].append({'campaign':campaign,'number':n,'stage':a['stage'],'path':a['path'],
                'status':a['status'],'finish_reason':receipt['finish_reason'],'dispatched_utc':a['dispatched_utc'],
                'request_sha256':a['request_sha256'],'response_sha256':a['response_sha256'],
                'client_request_sha256':a['client_request_sha256'],'cache_namespace_sha256':a['cache_namespace_sha256'],
                'removed_client_max_tokens':a['removed_client_max_tokens'],
                'rub':q['rub'],'usd':q['cost'],'band':q['band'],'tokens':q['tokens']})
        assigned=[]
        for c in d['cases']:
            out={k:c[k] for k in ['name','rows','kind','question','expected','cache_sequence','cache_phase','input_characters','input_bytes','input_sha256']};out['methods']={}
            for method,v in c['methods'].items():
                ns=v['attempt_numbers'];assigned+=ns;qs=[quotes[n] for n in ns]
                assert all(attempts[n]['cache_namespace_sha256']==v['cache_namespace_sha256'] for n in ns)
                assert [attempts[n]['stage'] for n in ns].count('selector')==1 and attempts[ns[0]]['stage']=='selector'
                item={k:v[k] for k in ['state','elapsed_seconds','selector_seconds','answer_seconds','answer','selection_correct','packing_used','encoded_data_characters','resources','input_unchanged','finish'] if k in v}
                item.update(calls=len(ns),rub=str(sum((Decimal(q['rub']) for q in qs),Decimal(0))),
                    selector_rub=quotes[ns[0]]['rub'],answer_rub=str(sum((Decimal(quotes[n]['rub']) for n in ns[1:]),Decimal(0))),
                    tokens={k:sum(q['tokens'][k] for q in qs) for k in ['input','miss','hit','out']},
                    selector_tokens=quotes[ns[0]]['tokens'],first_answer_tokens=quotes[ns[1]]['tokens'] if len(ns)>1 else None,
                    attempt_numbers=ns,campaign=campaign,cache_namespace_sha256=v['cache_namespace_sha256'])
                if method=='harness' and 'result' in v:
                    events=v['result']['events'];item['tool_calls']=sum(e['type']=='tool/call' for e in events)
                    item['tool_errors']=sum(e['type']=='tool/result' and e['data']['message'].get('isError',False) for e in events)
                out['methods'][method]=item
            if set(out['methods'])=={'direct','harness'}:
                assert out['methods']['direct']['cache_namespace_sha256']!=out['methods']['harness']['cache_namespace_sha256']
                dcost=Decimal(out['methods']['direct']['rub']);hcost=Decimal(out['methods']['harness']['rub'])
                out['harness_full_cost_saving_percent']=str((dcost-hcost)/dcost*100)
            result['cases'].append(out)
        assert sorted(assigned)==sorted(attempts) and len(set(assigned))==len(assigned)
    result.update(new_model_calls=calls,new_cost_rub=str(total),cumulative_calls=calls+65,
                  cumulative_cost_rub=str(total+Decimal(result['prior_research_rub'])),
                  unknown_usage=0,raw_receipts_reparsed=True)
    target=HERE/'FULL_COST_RESULTS.json';target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    for c in result['cases']:
        print(json.dumps({'name':c['name'],'phase':c['cache_phase'],'rows':c['rows'],'characters':c['input_characters'],
            'expected':c['expected'],'methods':{m:{k:v[k] for k in ['rub','calls','elapsed_seconds','answer','selector_tokens','first_answer_tokens']} for m,v in c['methods'].items()}},ensure_ascii=False))
    print(json.dumps({k:result[k] for k in ['new_model_calls','new_cost_rub','cumulative_calls','cumulative_cost_rub']}))
if __name__=='__main__':main()
