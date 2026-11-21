"""Finite authorized owner-key checks; no secrets, response values, or reports logged."""
import copy,json,pathlib,sys,time,urllib.error,uuid
sys.dont_write_bytecode=True
CORE=pathlib.Path('/opt/alice-market/releases/20261106-store-check-6098-r1')
sys.path.insert(0,str(CORE))
from store_checker import Checker,loads
from shared_http import read_response

D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108')
OUT=D/'owner-key-probe.json'
def main():
    ozon=json.loads(pathlib.Path('/etc/alice-lab/marketplaces/ozon.json').read_text())
    wb=json.loads(pathlib.Path('/etc/alice-lab/marketplaces/wb.json').read_text())
    seller={'client_id':str(ozon['seller_client_id']),'api_key':ozon['seller_api_key']}
    perf={'client_id':ozon['performance_client_id'],'client_secret':ozon['performance_client_secret']}
    other_id=str(int(seller['client_id'])+1)
    cases=[('seller_actual','SELLER',seller),('seller_wrong_client_canary','SELLER',{**seller,'client_id':other_id}),
        ('seller_wrong_key_canary','SELLER',{**seller,'api_key':str(uuid.uuid4())}),
        ('performance_actual','PERFORMANCE',perf),('wb_actual','WB',{'token':wb['seller_token']})]
    results=[]
    for name,kind,credential in cases:
        row={'case':name,'kind':kind};start=time.monotonic()
        def exchange(request,**kwargs):
            try:raw,status=read_response(request,**kwargs)
            except urllib.error.HTTPError as error:
                row['http_status']=error.code;raise
            row['http_status']=status
            try:data=loads(raw)
            except (ValueError,UnicodeError):data=None
            row['json_object']=isinstance(data,dict)
            if isinstance(data,dict):
                row['response_field_names']=[k for k in data if isinstance(k,str) and k.replace('_','').isascii() and k.replace('_','').isalnum() and len(k)<64]
                if kind=='SELLER':
                    company=data.get('company');row['company_object']=isinstance(company,dict)
                    row['expected_company_fields_present']=isinstance(company,dict) and all(isinstance(company.get(k),str) and 0<len(company[k])<=300 for k in ['name','country','currency','inn'])
                    if isinstance(company,dict):row['company_field_names']=[k for k in company if isinstance(k,str) and k.replace('_','').isascii() and k.replace('_','').isalnum() and len(k)<64]
                elif kind=='PERFORMANCE':
                    row['access_token_issued']=isinstance(data.get('access_token'),str) and bool(data['access_token'])
                    row['bearer_type']=str(data.get('token_type','')).lower()=='bearer'
                    row['positive_expiry']=type(data.get('expires_in')) is int and data['expires_in']>0
                else:
                    try:row['sid_uuid4']=isinstance(data.get('sid'),str) and uuid.UUID(data['sid']).version==4
                    except (ValueError,AttributeError):row['sid_uuid4']=False
            return raw,status
        message={'schema_version':'rt_check_v1','operation':'check_store','pins':{'environment':'stage','product_id':'alisa_market','tenant_id':str(uuid.uuid4()),'store_id':str(uuid.uuid4()),'provider':'WB' if kind=='WB' else 'OZON','kind':kind,'credential_revision':1,'store_revision':1,'request_id':str(uuid.uuid4())},'credential':credential}
        result=Checker(enabled=[kind],exchange=exchange).check(message,'stage')
        row['current_product_code']=result['code'];row['duration_ms']=round((time.monotonic()-start)*1000);results.append(row)
    return {'scope':'AUTHORIZED_REAL_OWNER_CREDENTIALS_READ_ONLY_API_NO_DB_OR_KEY_IMPORT','provider_request_count':len(cases),'cases':results,'production_changed':False,'secrets_response_values_or_tokens_recorded':False}
if __name__=='__main__':
    if OUT.exists() or OUT.is_symlink():raise SystemExit('Existing outcome retained')
    try:result=main()
    except Exception as error:result={'scope':'AUTHORIZED_OWNER_KEY_PROBE','status':'FAILED','error_type':type(error).__name__}
    with OUT.open('x') as output:json.dump(result,output,indent=2)
    OUT.chmod(0o600);print(json.dumps(result))
