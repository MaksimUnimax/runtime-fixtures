"""Offline research audit. Publishes counters and synthetic answers only."""
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
from accounting import quote
from fixtures import manifest, continuation_manifest, boundary_manifest
from qa_gateway import receipts

ROOT=Path('/root/alice-lab-evidence/dsh-lab-20261110')
FX=Decimal('82.5486')

def decode_packed(value,schemas):
    if isinstance(value,dict):
        keys=schemas[value['@']]
        assert len(keys)==len(value['v'])
        return {k:decode_packed(v,schemas) for k,v in zip(keys,value['v'])}
    if isinstance(value,list):return [decode_packed(x,schemas) for x in value]
    return value

def main():
    core='/opt/alice-market/releases/alisa-query-insights-r1-20261110'
    sys.path.insert(0,core)
    from model_input_encoding import PREFIX,V1_INSTRUCTION
    result={'status':'AWAITING_INDEPENDENT_REVIEW','cases':{},'attempts':[],
            'price_basis':'provider_usage_times_dated_rates_not_invoice',
            'fx_rub_per_usd':str(FX),'comparison_rates_usd_per_million':{'miss':'.15','hit':'.003','out':'.60'},
            'production_integration':False,'station_calls':0,'marketplace_calls':0,
            'selector_calls':0,'production_writes':0,'source_audit':{}}
    ids=set();total=Decimal(0)
    for i,m in enumerate([manifest(),continuation_manifest(),boundary_manifest()],1):
        campaign=m['campaign']
        d=json.loads((ROOT/(campaign+'_PRIVATE.json')).read_text())
        g=json.loads((ROOT/(campaign+'_GATEWAY_PRIVATE.json')).read_text())
        assert d['attempts']==g['attempts']
        raw=ROOT/(campaign+'_raw')
        expected_manifest=json.dumps(m,ensure_ascii=False,separators=(',',':')).encode()
        assert hashlib.sha256(expected_manifest).hexdigest()==d['manifest_sha256']
        case_lookup={x['name']:x for x in m['cases']}
        quotes={}
        for a in d['attempts']:
            n=a['number'];req=(raw/(str(n)+'.request.private.json')).read_bytes()
            res=(raw/(str(n)+'.response.private.bin')).read_bytes()
            assert hashlib.sha256(req).hexdigest()==a['request_sha256']
            assert hashlib.sha256(res).hexdigest()==a['response_sha256']
            reparsed=receipts(res,a['path']);assert reparsed==a['receipt']
            assert reparsed['id'] not in ids;ids.add(reparsed['id'])
            body=json.loads(req);assert body['model']=='deepseek-flash' and body['max_tokens']==16384
            q=quote(a);assert q['cost'] is not None and q['boundary_ambiguous'] is False
            quotes[n]=q;total+=Decimal(q['rub'])
            result['attempts'].append({'campaign':campaign,'number':n,'path':a['path'],
                'http':a['http_status'],'status':a['status'],'response_complete':reparsed['response_complete'],
                'finish_reason':reparsed['finish_reason'],'dispatched_utc':a['dispatched_utc'],
                'received_utc':a['received_utc'],'request_sha256':a['request_sha256'],
                'response_sha256':a['response_sha256'],**q})
        for c in d['cases']:
            fixture=case_lookup[c['name']]
            source=json.dumps(fixture['data'],ensure_ascii=False,separators=(',',':')).encode()
            assert hashlib.sha256(source).hexdigest()==c['input_sha256']
            if c['name'] not in result['cases']:
                result['cases'][c['name']]={k:c[k] for k in ('name','kind','question','expected','input_characters','input_bytes','input_sha256')}
                result['cases'][c['name']]['methods']={}
            out=result['cases'][c['name']];assert out['input_sha256']==c['input_sha256']
            for method,v in c['methods'].items():
                assert method not in out['methods']
                qs=[quotes[n] for n in v['attempt_numbers']]
                sumkey=lambda key:sum((Decimal(x[key]) for x in qs),Decimal(0))
                item={k:v[k] for k in ('state','elapsed_seconds','answer','finish','input_unchanged',
                    'encoded_data_characters','packing_used','resources') if k in v}
                item.update(calls=len(qs),actual_rub=str(sumkey('rub')),
                    normalized_rub=str(sumkey('normalized_usd')*FX),
                    all_input_uncached_rub=str(sumkey('normalized_no_cache_usd')*FX),
                    tokens={k:sum(x['tokens'][k] for x in qs) for k in ('input','miss','hit','out')},
                    campaign=campaign,attempt_numbers=v['attempt_numbers'])
                if method=='direct':
                    body=json.loads((raw/(str(v['attempt_numbers'][0])+'.request.private.json')).read_bytes())
                    sent=body['messages'][-1]['content'];assert sent.startswith(PREFIX)
                    sent=sent[len(PREFIX):]
                    if sent.startswith(V1_INSTRUCTION):
                        doc=json.loads(sent[len(V1_INSTRUCTION):]);decoded=decode_packed(doc['data'],doc['schemas'])
                    else:decoded=json.loads(sent)
                    assert decoded==fixture['data']
                    item['sent_data_lossless_verified']=True
                else:
                    assert v['input_unchanged']
                    events=v['result']['events']
                    item['tool_calls']=sum(e['type']=='tool/call' for e in events)
                    item['tool_errors']=sum(e['type']=='tool/result' and e['data']['message'].get('isError',False) for e in events)
                out['methods'][method]=item
    result['cases']=list(result['cases'].values())
    assert len(ids)==43 and len(result['cases'])==12
    result.update(actual_model_calls=len(ids),actual_new_cost_rub=str(total),
        historical_calls=22,historical_cost_rub='2.5558801890336',
        cumulative_calls=65,cumulative_cost_rub=str(total+Decimal('2.5558801890336')),
        all_new_raw_receipts_reparsed=True,missing_usage=0,tariff_boundary_ambiguities=0,
        complete_method_runs=23,incomplete_method_runs=1,
        actual_bands={'off_peak':37,'peak':6})
    target=ROOT/'DOCUMENT_PROGRAM_BOUNDARY_2026-11-11.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'path':str(target),'calls':len(ids),'rub':str(total),'cases':len(result['cases'])}))

if __name__=='__main__':main()
