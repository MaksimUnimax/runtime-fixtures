#!/usr/bin/env python3
"""Read-only DNS, HTTP redirect and HTTPS marker check. Never changes server/DNS.
Run after an infrastructure engineer applies DOMAIN_SETUP.md. Uses normal CA validation.
This is not a product or capacity test. Initial NXDOMAIN is an honest NOT_READY.
"""
from __future__ import annotations
import argparse, concurrent.futures, ipaddress, json, socket, ssl, sys
import urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ALLOWED={x+'.octoport.ru' for x in ('alisa','alisa-admin','id','alisa-stage','alisa-admin-stage','id-stage')}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

def request(url:str,timeout:float):
    opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    req=urllib.request.Request(url,headers={'User-Agent':'Alisa-Domain-Preflight-v0.5'})
    try:
        with opener.open(req,timeout=timeout) as r:
            return r.status,dict(r.headers),r.read(16385)
    except urllib.error.HTTPError as e:
        return e.code,dict(e.headers),e.read(16385)

def marker_ok(body:bytes,host:str,environment:str)->bool:
    if len(body)>16384:return False
    try:x=json.loads(body)
    except (ValueError,UnicodeError):return False
    return isinstance(x,dict) and x.get('marker')=='ALISA_PLATFORM_PREFLIGHT_V04' and x.get('host')==host and x.get('environment')==environment and x.get('application_ready') is False

def check(d:dict,expected:str,timeout:float)->dict:
    host=d['host'];out={'host':host,'environment':d['environment'],'passed':False}
    try:
        ips=sorted({x[4][0] for x in socket.getaddrinfo(host,443,socket.AF_INET,socket.SOCK_STREAM)})
        out['ipv4']=ips;out['dns_matches_expected']=(ips==[expected])
        if not out['dns_matches_expected']:out['error']='DNS_MISMATCH';return out
        status,headers,body=request('https://'+host+'/__setup/ready',timeout)
        out['https_status']=status;out['tls_validation']='VERIFIED_IF_REQUEST_SUCCEEDED'
        out['marker_matches']=status==200 and marker_ok(body,host,d['environment'])
        hs={k.lower():v for k,v in headers.items()}
        out['no_store']='no-store' in hs.get('cache-control','').lower()
        out['noindex']='noindex' in hs.get('x-robots-tag','').lower()
        code,h,_=request('http://'+host+'/',timeout)
        h={k.lower():v for k,v in h.items()}
        out['http_redirect']=code in (301,302,307,308) and h.get('location')=='https://'+host+'/'
        out['passed']=all(out[k] for k in ['dns_matches_expected','marker_matches','no_store','noindex','http_redirect'])
    except Exception as e:
        out['error_type']=type(e).__name__
        out['error']=str(e)[:400]
    return out

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--expected-ip',required=True);p.add_argument('--timeout',type=float,default=10)
    p.add_argument('--output',type=Path,default=Path('domains-check.json'));a=p.parse_args()
    try:ipaddress.IPv4Address(a.expected_ip)
    except ValueError:p.error('expected-ip must be a confirmed IPv4 address')
    if not 1<=a.timeout<=60:p.error('timeout must be 1..60 seconds')
    ds=json.loads((ROOT/'infra/domains.json').read_text())
    if len(ds)!=6 or {d.get('host') for d in ds}!=ALLOWED:raise SystemExit('Unexpected domain set; review changes explicitly')
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        results=list(ex.map(lambda d:check(d,a.expected_ip,a.timeout),ds))
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'read_only':True,'expected_ip':a.expected_ip,'verdict':'DNS_HTTPS_MARKERS_OK' if all(x['passed'] for x in results) else 'NOT_READY','dev_ready':False,'results':results,'limits':['Not authoritative DNS verification; check NS and independent resolvers separately.','Does not test renewal, SMTP, access, capacity, applications or isolation.','No -k or insecure TLS bypass used.']}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(report['verdict']);print(a.output)
    return 0 if all(x['passed'] for x in results) else 1
if __name__=='__main__':sys.exit(main())
