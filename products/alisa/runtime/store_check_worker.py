"""One bounded product check process. Credentials enter stdin, never argv/env."""
import argparse
import json
from pathlib import Path
import resource
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from store_checker import Checker, MAX_MESSAGE, VERSION, loads, validate
import product_catalog


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--environment', required=True, choices=['dev', 'stage', 'prod'])
    parser.add_argument('--enable-kind', action='append', default=[], choices=['WB', 'SELLER', 'PERFORMANCE'])
    parser.add_argument('--seller-binding-qualified', action='store_true')
    parser.add_argument('--enable-catalog', action='store_true')
    args = parser.parse_args()
    resource.setrlimit(resource.RLIMIT_AS, (256*1048576, 256*1048576))
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    pins = {}; version=VERSION
    try:
        raw = sys.stdin.buffer.readline(MAX_MESSAGE+1)
        if len(raw) > MAX_MESSAGE or not raw.endswith(b'\n'):
            raise ValueError()
        message = loads(raw)
        if message.get('schema_version')==product_catalog.VERSION:
            if not args.enable_catalog:raise ValueError()
            pins,_,_=product_catalog.validate(message,args.environment);version=product_catalog.VERSION
            if pins['kind']not in args.enable_kind:raise ValueError()
            result=product_catalog.CatalogReader().page(message,args.environment)
        else:
            pins, _ = validate(message, args.environment)
            result = Checker(enabled=args.enable_kind, seller_binding_qualified=args.seller_binding_qualified).check(message, args.environment)
    except Exception:
        result = {'code': 'CHECK_UNAVAILABLE'}
    sys.stdout.write(json.dumps({'schema_version': version, 'pins': pins, 'result': result}, separators=(',', ':'))+'\n')


if __name__ == '__main__':
    main()
