"""Bounded read-only qualification collector for one Ozon source over a date range.
Not a skill runtime or deployed speech template. No LLM, writes, redirects or credentials in outputs.
"""
from __future__ import annotations
import argparse,datetime as dt,fcntl,hashlib,json,os,pathlib,sqlite3,time,urllib.request,urllib.error
ROOT=pathlib.Path('/var/lib/alice-lab/probe-reports')
CFG=pathlib.Path('/etc/alice-market/market-runtime.json')
DB='/var/lib/alice-market/state.sqlite3'
ENDPOINT='https://api-seller.ozon.ru/v1/finance/accrual/by-day'
MANIFEST=ROOT/'ozon_price_volume_202610_manifest.json'
PREFIX='ozon_price_volume_202610'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k):return None
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(p,value):
    tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2));tmp.chmod(0o600);tmp.replace(p)
def scope():
    cfg=json.loads(CFG.read_text())
    if cfg.get('execution_enabled') is not True:raise RuntimeError('LIVE_DISABLED')
    stores={s['id']:s for a in cfg['accounts'].values() if a.get('active') for s in a['stores'] if s['platform']=='ozon'}
    if len(stores)!=1:raise RuntimeError('AMBIGUOUS_STORE')
    return next(iter(stores.values()))
def reserve(source,job):
    while True:
        con=sqlite3.connect(DB,timeout=2);con.execute('BEGIN IMMEDIATE');now=time.time()
        blocked=con.execute("SELECT 1 FROM calls WHERE source=? AND state IN ('UNKNOWN','SENDING')",(source,)).fetchone()
        if blocked:con.rollback();con.close();raise RuntimeError('SOURCE_OUTCOME_BLOCKED')
        rate=con.execute('SELECT not_before FROM rates WHERE source=?',(source,)).fetchone()
        if rate and rate[0]>now:
            delay=min(1.0,rate[0]-now);con.rollback();con.close();time.sleep(delay);continue
        if con.execute('SELECT COUNT(*) FROM calls WHERE source=? AND at>?',(source,now-86400)).fetchone()[0]>=100:
            con.rollback();con.close();raise RuntimeError('DAILY_QUALIFICATION_LIMIT')
        call=con.execute("INSERT INTO calls(jid,source,at,state) VALUES(?,?,?,'SENDING')",(job,source,now)).lastrowid
        con.execute('INSERT OR REPLACE INTO rates VALUES(?,?)',(source,now+2.0));con.commit();con.close();return call
def update_call(call,record,source,delay=None):
    with sqlite3.connect(DB,timeout=2) as con:
        con.execute('UPDATE calls SET state=?,http=?,elapsed_ms=?,response_bytes=? WHERE id=?',
                    (record['state'],record.get('http'),record.get('elapsed_ms'),record.get('bytes'),call))
        if delay:
            old=con.execute('SELECT not_before FROM rates WHERE source=?',(source,)).fetchone()
            con.execute('INSERT OR REPLACE INTO rates VALUES(?,?)',(source,max(time.time()+delay,old[0] if old else 0)))
def main():
    os.umask(0o077);parser=argparse.ArgumentParser();parser.add_argument('--max-days',type=int,default=31);args=parser.parse_args()
    lock=open('/root/alice-lab-evidence/customer-price-20261104/month-collector.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    store=scope();source='ozon:'+store['identity']+':ozon_accrual_by_day'
    if MANIFEST.exists():m=json.loads(MANIFEST.read_text())
    else:m={'schema':'ozon-source-range-qualification/v1','from':'2026-10-01','to':'2026-10-31','endpoint':ENDPOINT,
            'started_utc':utc(),'started_epoch':time.time(),'state':'COLLECTING','logical_reports':1,'requests':[],'days':{},'runtime_template_installed':False}
    if m['state'] in ('UNKNOWN','ERROR'):raise SystemExit('Inspect existing blocked manifest; automatic restart disabled')
    processed=0
    try:
        for n in range(1,32):
            day=f'2026-10-{n:02d}';d=m['days'].setdefault(day,{'complete':False,'pages':[]})
            if d['complete']:continue
            if processed>=args.max_days:break
            cursor='';seen=set()
            for page in range(1,6):
                retries=0
                while True:
                    if scope()['id']!=store['id']:raise RuntimeError('STORE_ACCESS_CHANGED')
                    call=reserve(source,'customer-price-month-202610')
                    rec={'seq':len(m['requests'])+1,'date':day,'page':page,'body':{'date':day,'last_id':cursor},
                         'started_utc':utc(),'call_id':call,'state':'SENDING'}
                    m['requests'].append(rec);save(MANIFEST,m)
                    cred=json.loads(pathlib.Path('/etc/alice-lab/marketplaces/ozon.json').read_text())
                    req=urllib.request.Request(ENDPOINT,data=json.dumps(rec['body']).encode(),
                        headers={'Client-Id':cred['seller_client_id'],'Api-Key':cred['seller_api_key'],'Content-Type':'application/json'},method='POST')
                    start=time.monotonic()
                    try:
                        with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(req,timeout=25) as response:
                            raw=response.read(6000001);status=response.status
                        rec.update(state='RECEIVED',http=status,elapsed_ms=round((time.monotonic()-start)*1000,3),bytes=len(raw),finished_utc=utc())
                        update_call(call,rec,source)
                        path=ROOT/f'{PREFIX}_{day}_p{page}.json';path.write_bytes(raw);path.chmod(0o600)
                        rec.update(response_path=str(path),sha256=hashlib.sha256(raw).hexdigest())
                        save(MANIFEST,m)
                        if len(raw)>6000000:raise ValueError('RESPONSE_SIZE')
                        data=json.loads(raw)
                        if not isinstance(data,dict) or not isinstance(data.get('accruals'),list) or not isinstance(data.get('last_id'),str):raise ValueError('RESPONSE_SCHEMA')
                        if len(data['accruals'])>20000:raise ValueError('ROW_LIMIT')
                        break
                    except urllib.error.HTTPError as e:
                        delay=60
                        try:delay=max(2,min(3600,int(e.headers.get('Retry-After','60'))))
                        except (ValueError,TypeError):pass
                        rec.update(state='HTTP_ERROR',http=e.code,elapsed_ms=round((time.monotonic()-start)*1000,3),finished_utc=utc())
                        update_call(call,rec,source,delay if e.code==429 else None);save(MANIFEST,m);e.close()
                        if rec['http']==429 and retries<1:retries+=1;continue
                        raise RuntimeError('HTTP_'+str(rec['http'])) from None
                    except (urllib.error.URLError,TimeoutError,ConnectionError,OSError) as e:
                        rec.update(state='UNKNOWN',exception_type=type(e).__name__,elapsed_ms=round((time.monotonic()-start)*1000,3),finished_utc=utc())
                        update_call(call,rec,source);m['state']='UNKNOWN';save(MANIFEST,m);raise RuntimeError('NETWORK_OUTCOME_UNKNOWN') from None
                d['pages'].append({'seq':rec['seq'],'path':rec['response_path'],'sha256':rec['sha256'],'records':len(data['accruals'])})
                new_cursor=data['last_id']
                if not new_cursor:d['complete']=True;break
                if new_cursor==cursor or new_cursor in seen:raise ValueError('REPEATED_CURSOR')
                seen.add(new_cursor);cursor=new_cursor
            if not d['complete']:raise ValueError('PAGINATION_LIMIT')
            d['finished_utc']=utc();save(MANIFEST,m);processed+=1
            print(json.dumps({'day':day,'pages':len(d['pages']),'records':sum(x['records'] for x in d['pages']),'completed_days':sum(x['complete'] for x in m['days'].values()),'http_requests':len(m['requests'])}),flush=True)
        if len(m['days'])==31 and all(x['complete'] for x in m['days'].values()):
            m.update(state='ACQUIRED',acquired_utc=utc(),acquisition_wall_s=round(time.time()-m['started_epoch'],3))
        save(MANIFEST,m)
        print(json.dumps({'state':m['state'],'completed_days':sum(x['complete'] for x in m['days'].values()),'requests':len(m['requests']),'acquisition_wall_s':m.get('acquisition_wall_s')}),flush=True)
    except Exception as e:
        if m['state']!='UNKNOWN':m['state']='ERROR'
        m.update(error_type=type(e).__name__,error=str(e),failed_utc=utc());save(MANIFEST,m)
        print(json.dumps({'state':m['state'],'error':str(e),'completed_days':sum(x['complete'] for x in m['days'].values())}),flush=True);raise
if __name__=='__main__':main()
