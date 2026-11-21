"""Finite many-to-one enrichment and calendar windows, entirely catalogue-defined.
No provider names, credentials, IO, SQL, eval, fuzzy IDs or inferred authorization.
Call only inside a fully validated single-store dataset block. All matched amounts
remain left-side values; coverage of metadata is distinct from source completeness.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import date,timedelta
from decimal import Decimal,InvalidOperation
import re
from matrix_core import MatrixError,fail,canonical,money,decimal_text,validate_expression,_evaluate

NAME=re.compile(r'[a-z][a-z0-9_]{0,79}\Z')

def need(ok,code):
    if not ok:fail(code)

def name(value):return type(value)is str and NAME.fullmatch(value) is not None

def names(value,minimum=1,maximum=16):
    return type(value)is list and minimum<=len(value)<=maximum and all(name(x) for x in value) and len(value)==len(set(value))

def validate_window(window):
    need(type(window)is dict and set(window)=={'start_offset_days','end_offset_days','chunk_days'},'JOIN_WINDOW_SCHEMA')
    a,b,n=(window[k] for k in ('start_offset_days','end_offset_days','chunk_days'))
    need(type(a)is int and -365<=a<=0 and type(b)is int and -365<=b<=0 and type(n)is int and 1<=n<=365,'JOIN_WINDOW_SCHEMA')

def calendar_windows(stage,period):
    """Nonoverlapping inclusive chunks, with explicit bounded metadata lookback."""
    try:
        need(type(period)is dict and set(period)=={'from','to'},'JOIN_WINDOW_PERIOD')
        a,b=(date.fromisoformat(period[k]) for k in ('from','to'))
        need(a.isoformat()==period['from'] and b.isoformat()==period['to'] and 0<=(b-a).days<365,'JOIN_WINDOW_PERIOD')
        w=stage.get('window')
        if w is None:return [dict(period)]
        validate_window(w)
        a+=timedelta(days=w['start_offset_days']);b+=timedelta(days=w['end_offset_days'])
        need(0<=(b-a).days<365,'JOIN_WINDOW_PERIOD')
        out=[]
        while a<=b:
            end=min(b,a+timedelta(days=w['chunk_days']-1));out.append({'from':a.isoformat(),'to':end.isoformat()});a=end+timedelta(days=1)
        return out
    except MatrixError:raise
    except (ValueError,OverflowError,TypeError,KeyError):fail('JOIN_WINDOW_PERIOD')

def validate_relation(recipe,available):
    try:
        required={'id','label','left','right','on','parent_keys','left_where','capacity','preserve','fields','coverage_field','missing'}
        need(type(recipe)is dict and set(recipe)==required,'JOIN_SCHEMA')
        need(name(recipe['id']) and recipe['id'] not in available,'JOIN_STAGE_ID')
        need(type(recipe['label'])is str and 1<=len(recipe['label'])<=120 and not any(ord(c)<32 or c in '<>{}' for c in recipe['label']),'JOIN_LABEL')
        need(name(recipe['left']) and recipe['left'] in available,'JOIN_STAGE_REFERENCE')
        need(names(recipe['right'],1,8) and set(recipe['right'])<=set(available) and recipe['left'] not in recipe['right'],'JOIN_STAGE_REFERENCE')
        on=recipe['on'];need(type(on)is list and 1<=len(on)<=4,'JOIN_KEYS')
        for pair in on:need(type(pair)is list and len(pair)==2 and all(name(v) for v in pair),'JOIN_KEYS')
        need(len({x[0] for x in on})==len(on) and len({x[1] for x in on})==len(on),'JOIN_KEYS')
        parent=recipe['parent_keys'];need(type(parent)is list and len(parent)<=len(on) and all(type(i)is int and 0<=i<len(on) for i in parent) and len(set(parent))==len(parent),'JOIN_PARENT_KEYS')
        validate_expression(recipe['left_where'],{'row'})
        need(names(recipe['preserve'],1,16),'JOIN_CONSERVATION_FIELDS')
        cap=recipe['capacity']
        if cap is not None:
            need(type(cap)is dict and set(cap)=={'left','right','mode'} and name(cap['left']) and name(cap['right']) and cap['mode'] in ('sum_le','sum_equal'),'JOIN_CAPACITY_SCHEMA')
            need(cap['left'] in recipe['preserve'],'JOIN_CAPACITY_SCHEMA')
        fields=recipe['fields'];need(type(fields)is dict and 1<=len(fields)<=8,'JOIN_FIELDS')
        for dest,spec in fields.items():
            need(name(dest) and dest not in recipe['preserve'] and dest not in ('key',),'JOIN_FIELDS')
            need(type(spec)is dict and set(spec)=={'source','unknown','unknown_values'} and name(spec['source']),'JOIN_FIELDS')
            need(type(spec['unknown'])is str and 1<=len(spec['unknown'])<=160 and not any(ord(c)<32 for c in spec['unknown']),'JOIN_FIELDS')
            vals=spec['unknown_values'];need(type(vals)is list and len(vals)<=8 and all(v is None or type(v)is str and len(v)<=160 for v in vals),'JOIN_FIELDS')
        need(name(recipe['coverage_field']) and recipe['coverage_field'] not in fields and recipe['coverage_field'] not in recipe['preserve'] and recipe['coverage_field']!='key','JOIN_FIELDS')
        need(recipe['missing'] in ('report_unknown','reject'),'JOIN_MISSING_POLICY')
    except MatrixError:raise
    except (KeyError,TypeError,ValueError,RecursionError):fail('JOIN_SCHEMA')

def validate_relations(relations,source_ids):
    need(type(relations)is list and len(relations)<=8,'JOIN_SCHEMA')
    available=set(source_ids)
    for r in relations:
        validate_relation(r,available);available.add(r['id'])
    return available

def _key(row,fields,nullable=False):
    vals=[]
    for field in fields:
        need(field in row,'JOIN_KEY_MISSING');v=row[field]
        if nullable and (v is None or v==''):return None
        need(type(v)is str and 1<=len(v)<=160 and not any(ord(c)<32 for c in v),'JOIN_KEY_TYPE');vals.append(v)
    return tuple(vals)

def _rows(rows,limit):
    need(type(rows)is list and len(rows)<=limit,'JOIN_ROW_LIMIT');seen=set()
    for row in rows:
        need(type(row)is dict,'JOIN_ROW_SCHEMA');key=_key(row,['key'])
        need(key not in seen,'JOIN_ROW_DUPLICATE');seen.add(key)

def _totals(rows,fields):
    out={}
    for f in fields:
        try:out[f]=decimal_text(sum((money(row[f]) for row in rows),Decimal(0)))
        except MatrixError:raise
        except (KeyError,TypeError,InvalidOperation):fail('JOIN_MEASURE_MISSING')
    return out

def _quantity(value):
    n=money(value);need(n>=0 and n==n.to_integral_value(),'JOIN_QUANTITY_TYPE');return n

def enrich(recipe,datasets,*,max_rows=20000,max_bytes=6000000):
    """Retain one output row per selected left row, never multiply or drop money.
    Exact keys are required. A repeated right key is an error even if rows agree.
    No metadata coverage assertion can be inferred just from HTTP200 or this join.
    """
    need(type(max_rows)is int and 1<=max_rows<=20000 and type(max_bytes)is int and 1<=max_bytes<=6000000,'JOIN_LIMIT')
    validate_relation(recipe,set(datasets))
    left=datasets[recipe['left']];_rows(left,max_rows)
    right=[]
    for stage in recipe['right']:
        _rows(datasets[stage],max_rows);right.extend(datasets[stage]);need(len(right)<=max_rows,'JOIN_ROW_LIMIT')
    need(len(canonical([left,right]).encode())<=max_bytes,'JOIN_BYTE_LIMIT')
    lk=[p[0] for p in recipe['on']];rk=[p[1] for p in recipe['on']];parents=recipe['parent_keys']
    index={};parentset=set()
    for row in right:
        key=_key(row,rk);need(key not in index,'JOIN_RIGHT_DUPLICATE');index[key]=row
        if parents:parentset.add(tuple(key[i] for i in parents))
    selected=[]
    for row in left:
        try:include=_evaluate(recipe['left_where'],{'row':row})
        except MatrixError:raise
        except (KeyError,TypeError,ValueError,IndexError):fail('JOIN_SELECTION')
        need(type(include)is bool,'JOIN_SELECTION')
        if include:selected.append(row)
    before=_totals(selected,recipe['preserve']);out=[];groups={'matched':[],'unknown_value':[],'unmatched':[]};used=set();quantities={};cap=recipe['capacity']
    for row in selected:
        if cap is not None:
            need(cap['left'] in row,'JOIN_QUANTITY_MISSING');_quantity(row[cap['left']])
        need(not set(recipe['fields'])&set(row) and recipe['coverage_field'] not in row,'JOIN_FIELD_COLLISION')
        key=_key(row,lk,True);meta=index.get(key) if key is not None else None
        if meta is None and parents:
            parent=_key(row,[lk[i] for i in parents],True)
            need(parent not in parentset,'JOIN_ITEM_MISMATCH')
        if meta is None:need(recipe['missing']=='report_unknown','JOIN_UNMATCHED')
        item=deepcopy(row);status='matched' if meta is not None else 'unmatched'
        for dest,spec in recipe['fields'].items():
            if meta is None:item[dest]=spec['unknown'];continue
            need(spec['source'] in meta,'JOIN_FIELD_MISSING');v=meta[spec['source']]
            if v in spec['unknown_values']:item[dest]=spec['unknown'];status='unknown_value'
            else:
                need(type(v)is str and 1<=len(v)<=160 and not any(ord(c)<32 for c in v),'JOIN_FIELD_TYPE');item[dest]=v
        if meta is not None:
            used.add(key)
            if cap is not None:
                need(cap['left'] in row and cap['right'] in meta,'JOIN_QUANTITY_MISSING')
                qty=_quantity(row[cap['left']]);bound=_quantity(meta[cap['right']]);quantities[key]=quantities.get(key,Decimal(0))+qty
                need(quantities[key]<=bound,'JOIN_QUANTITY_EXCEEDED')
        item[recipe['coverage_field']]=status;out.append(item);groups[status].append(item)
    if cap is not None and cap['mode']=='sum_equal':
        for key,qty in quantities.items():need(qty==_quantity(index[key][cap['right']]),'JOIN_QUANTITY_MISMATCH')
    need(len(out)==len(selected) and _totals(out,recipe['preserve'])==before,'JOIN_CONSERVATION')
    need(len(canonical(out).encode())<=max_bytes,'JOIN_BYTE_LIMIT')
    receipt={'id':recipe['id'],'label':recipe['label'],'left_rows':len(left),'target_rows':len(out),'excluded_rows':len(left)-len(out),'metadata_rows':len(right),'used_metadata_keys':len(used),'unused_metadata_keys':len(index)-len(used),'enrichment_complete':not groups['unmatched'] and not groups['unknown_value'],'measures':{}}
    for status,rows in groups.items():receipt[status+'_rows']=len(rows)
    for field,value in before.items():
        receipt['measures'][field]={'target':value,**{s:_totals(rows,[field])[field] for s,rows in groups.items()}}
    return out,receipt

def apply_relations(query,datasets,*,max_rows=20000,max_bytes=6000000):
    relations=query.get('relations',[]);validate_relations(relations,set(datasets));work=dict(datasets);receipts=[]
    for relation in relations:
        rows,proof=enrich(relation,work,max_rows=max_rows,max_bytes=max_bytes);work[relation['id']]=rows;receipts.append(proof)
        need(len(canonical(work).encode())<=max_bytes,'JOIN_BYTE_LIMIT')
    return work,receipts
