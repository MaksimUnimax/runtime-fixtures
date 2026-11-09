"""Read-only local OWNER/service CLI. Never mounted as a customer web endpoint."""
import argparse,json
from template_gaps import GapStore

def main():
    p=argparse.ArgumentParser(description='Protected unsupported-template backlog; run as the runtime service user.')
    p.add_argument('--database',required=True);p.add_argument('--tenant');p.add_argument('--case-id');args=p.parse_args()
    if args.case_id and not args.tenant:p.error('--tenant is required with --case-id')
    s=GapStore(args.database)
    value=s.get(args.tenant,args.case_id)if args.case_id else s.list(args.tenant)
    print(json.dumps(value,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
