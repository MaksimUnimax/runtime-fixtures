"""Validate a candidate formula/speech catalogue without importing keys or doing HTTP."""
import argparse,json
from semantic_catalog import load_json,validate_speech,hash_value
from query_program import validate_catalog_typed

def main():
    p=argparse.ArgumentParser();p.add_argument('--expressions',required=True);p.add_argument('--speech',required=True)
    args=p.parse_args();catalog=validate_catalog_typed(load_json(args.expressions))
    speech=validate_speech(load_json(args.speech),catalog)
    print(json.dumps({'status':'PASS','catalog_hash':hash_value(catalog),'speech_hash':hash_value(speech),
                      'formulas':len(catalog['formulas']),'phrase_metric_groups':len(speech['phrases']),
                      'external_calls':0,'credentials_read':False},ensure_ascii=False))
if __name__=='__main__':main()
