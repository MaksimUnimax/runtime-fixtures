"""Evidence-backed labels, not account grants. No IO, purchases or quota changes.

A paid endpoint differs from a basic endpoint with paid parameters/response fields.
Unknown account entitlement never causes a speculative local refusal.
"""
from pathlib import Path
from copy import deepcopy
from datetime import date,datetime,timezone
from calendar import monthrange
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit
import hashlib,json,re,gzip

DATA=Path(__file__).with_name('subscription_access.json.gz')
POLICY=json.loads(gzip.decompress(DATA.read_bytes()))
HASH=hashlib.sha256(gzip.decompress(DATA.read_bytes())).hexdigest()
assert POLICY['schema']=='alisa-subscription-access/v1'
PRODUCTS=set(POLICY['products'])
for alias,row in POLICY['methods'].items():
    assert alias==row['operation'] and row['group']in POLICY['labels']
    assert all(p in PRODUCTS for p in row['accepted_products']+row['full_response_products'])
    assert all(ref in POLICY['sources']for ref in row['evidence'])
INDEX={(r['method'],r['path']):alias for alias,r in POLICY['methods'].items()}


def method_label(platform,operation):
    if platform!='ozon':return {'provider':'wb','group':'OTHER_PROVIDER','account_access':'NOT_CHECKED'}
    row=POLICY['methods'].get(operation)
    if row is None:return {'provider':'ozon','group':'UNKNOWN','account_access':'NOT_CHECKED'}
    fields=['group','label','base_access','accepted_products','full_response_products','evidence','evidence_basis','auth_exceptions']
    return {'provider':'ozon',**{k:deepcopy(row[k])for k in fields},'version':POLICY['version'],'account_access':'NOT_CHECKED'}


def _calendar_day(value):
    if type(value)is date:return value
    if type(value)is datetime:return value.date()
    if type(value)is not str:raise ValueError('date required')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):return date.fromisoformat(value)
    value=datetime.fromisoformat(value.replace('Z','+00:00'))
    if value.tzinfo is None:raise ValueError('timezone required')
    return value.astimezone(ZoneInfo('Europe/Moscow')).date()


def _months_before(today,months):
    value=today.year*12+today.month-1-months;year,month0=divmod(value,12)
    return date(year,month0+1,min(today.day,monthrange(year,month0+1)[1]))


def _matches(selector,params,today):
    field=selector['field'];value=params.get(field);kind=selector['type']
    if value is None:return False
    if kind=='date_older_than_months':return _calendar_day(value)<_months_before(today,selector['months'])
    if kind=='array_contains_any':
        if type(value)is not list:raise ValueError('array required')
        return any(v in selector['values']for v in value)
    if kind=='object_array_key_contains_any':
        if type(value)is not list or any(type(v)is not dict for v in value):raise ValueError('object array required')
        return any(v.get(selector['key'])in selector['values']for v in value)
    if kind=='value_in':return value in selector['values']
    raise ValueError('selector unknown')


def requirement(platform,operation,params,as_of):
    """Describe a validated request without asserting the store's purchased tier."""
    out=method_label(platform,operation)
    out.update(required_products=[],matched_features=[],rule_uncertainty=[],request_access='UNKNOWN',may_have_limited_response=False)
    if platform!='ozon'or operation not in POLICY['methods']:return out
    row=POLICY['methods'][operation];sets=[]
    if row['accepted_products']:sets.append(set(row['accepted_products']))
    try:
        if type(params)is not dict:raise ValueError('params required')
        today=_calendar_day(as_of)if row['feature_rules']else None
        for rule in row['feature_rules']:
            if _matches(rule['selector'],params,today):
                sets.append(set(rule['allowed_subscription_types']));out['matched_features'].append(rule['id'])
        if row['group']=='PREMIUM_PLUS_FEATURES':
            # Unrecognized metrics/dimensions are NOT automatically considered free.
            known_metrics=set(row['base_metrics']);known_dims=set(row['base_dimensions'])
            for rule in row['feature_rules']:
                sel=rule['selector']
                if sel['type']=='array_contains_any'and sel['field']=='metrics':known_metrics.update(sel['values'])
                if sel['type']=='array_contains_any'and sel['field']=='dimension':known_dims.update(sel['values'])
            for field,known in [('metrics',known_metrics),('dimension',known_dims)]:
                values=params.get(field,[])
                if type(values)is not list:raise ValueError('array required')
                if any(type(v)is not str or v not in known for v in values):out['rule_uncertainty'].append('UNVERIFIED_'+field.upper())
            for field in ('sort','filters'):
                items=params.get(field,[])
                if type(items)is not list or any(type(item)is not dict for item in items):raise ValueError('object array required')
                if any(item.get('key')not in known_metrics|known_dims for item in items):out['rule_uncertainty'].append('UNVERIFIED_'+field.upper())
    except (ValueError,TypeError,KeyError,OverflowError):out['rule_uncertainty'].append('REQUEST_RULE_NOT_EVALUATED')
    if sets:
        accepted=set.intersection(*sets)
        out['required_products']=[p for p in POLICY['products']if p in accepted]
        out['request_access']='PAID_REQUIREMENT_DOCUMENTED'if accepted else'UNKNOWN'
    elif row['group']in ('NO_PAID_REQUIREMENT_DOCUMENTED','PREMIUM_PLUS_FEATURES'):
        out['request_access']='NO_PAID_REQUIREMENT_DOCUMENTED'
    elif row['group']=='PREMIUM_FEATURES':
        out['request_access']='BASE_WITH_LIMITED_RESPONSE';out['may_have_limited_response']=True
    elif row['group']=='RETIRED':out['request_access']='RETIRED'
    elif row['group']in('FILE_RESOURCE_ACCESS','SEPARATE_PERFORMANCE_ACCESS'):out['request_access']='SEPARATE_ACCESS_POLICY'
    if out['rule_uncertainty']:out['request_access']='UNKNOWN'
    if row['full_response_products']:out['full_response_requires']=list(row['full_response_products'])
    return out


def endpoint_policy(method,url):
    p=urlsplit(url)
    if p.scheme!='https'or p.hostname!='api-seller.ozon.ru'or p.username or p.password or p.port not in(None,443):return None
    alias=INDEX.get((method.upper(),p.path))
    return deepcopy(POLICY['methods'].get(alias))if alias else None


def explicit_denial_products(text):
    """Only an explicit requirement, never arbitrary mentioning of an active plan."""
    value=text.casefold().replace('_',' ').replace('-',' ')
    if re.search(r'not\s+required|does\s+not\s+require|no\s+subscription\s+required|не\s+требует|не\s+нужн|не\s+связан.*подпис',value):return []
    if not re.search(r'requir|\bonly\b|\bneed\b|missing|not active|no subscription|необходим|требуе|только|отсутств',value):return []
    found=[]
    for clause in re.split(r'[;\n.]',value):
        if re.search(r'(?<!not )\b(?:is )?active\b|подписка\s+активна',clause)and not re.search(r'not active|не\s+активн',clause):continue
        if not re.search(r'requir|\bonly\b|\bneed\b|missing|not active|no subscription|необходим|требуе|только|отсутств',clause):continue
        for match in re.finditer(r'(?<![a-z])premium(?:\s*(plus|pro|lite|плюс|про))?(?![a-z])',clause):
            suffix=match.group(1);product={'plus':'PREMIUM_PLUS','плюс':'PREMIUM_PLUS','pro':'PREMIUM_PRO','про':'PREMIUM_PRO','lite':'PREMIUM_LITE',None:'PREMIUM'}[suffix]
            if product not in found:found.append(product)
        if re.search(r'управлени[ея]\s+отзывами|review\s+management',clause):found.append('REVIEWS_MANAGEMENT')

    return found


def enrich_denial(result,method,url,code,message):
    """Evidence about requirements is kept separate from an observed refusal cause."""
    row=endpoint_policy(method,url)
    if row:result['documented_access']={k:deepcopy(row[k])for k in ['group','accepted_products','base_access','evidence_basis']}
    if result['http']!=403 or code!=7 or type(message)is not str or endpoint_policy(method,url)is None:return result
    products=explicit_denial_products(message)
    # A purchase-related word without an identified subscription is not sufficient.
    if not products or not re.search(r'subscription|подписк|premium\s+(?:plus|pro)|управлени[ея]\s+отзывами',message,re.I):return result
    result['provider_required_products']=products
    result['public_code']='HTTP_403_OZON_SUBSCRIPTION_REQUIRED'
    result['reason']='OZON_PAID_SUBSCRIPTION_REQUIREMENT'
    mapping={('PREMIUM',):'HTTP_403_OZON_PREMIUM_REQUIRED',('PREMIUM_LITE',):'HTTP_403_OZON_PREMIUM_LITE_REQUIRED',('PREMIUM_PLUS',):'HTTP_403_OZON_PREMIUM_PLUS_REQUIRED',('PREMIUM_PRO',):'HTTP_403_OZON_PREMIUM_PRO_REQUIRED',('PREMIUM_PLUS','PREMIUM_PRO'):'HTTP_403_OZON_PLUS_OR_PRO_REQUIRED',('REVIEWS_MANAGEMENT',):'HTTP_403_OZON_REVIEWS_REQUIRED',('PREMIUM_PRO','REVIEWS_MANAGEMENT'):'HTTP_403_OZON_REVIEWS_OR_PRO_REQUIRED'}
    tier_code=mapping.get(tuple(sorted(products)))
    if row['accepted_products']and not set(products)<=set(row['accepted_products']):
        result['documentation_conflict']=True;result['tier_public_code']='HTTP_403_OZON_ACCESS_POLICY_CONFLICT'
    elif tier_code:result['tier_public_code']=tier_code
    return result
