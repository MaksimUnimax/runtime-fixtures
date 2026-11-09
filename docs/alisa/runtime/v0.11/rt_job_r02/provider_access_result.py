"""Typed negative tool result built from a received provider response, not a tier guess."""
from copy import deepcopy
import json,re
SCHEMA='alice-provider-access-result/v1'
NAMES={'PREMIUM':'Premium','PREMIUM_LITE':'Premium Lite','PREMIUM_PLUS':'Premium Plus','PREMIUM_PRO':'Premium Pro','REVIEWS_MANAGEMENT':'Управление отзывами'}
INSTRUCTION='Сообщи причину отказа и указанную Ozon подписку. Не повторяй отклонённый запрос, не меняй ключи, не выдавай неполученные данные за ноль. Не утверждай, что подписка оплачена или отсутствует, если это не подтверждено. Если название не указано, не придумывай его.'
FIELDS={'schema','ok','provider','operation','status','http_status','provider_code','required_subscriptions','subscription_relation','requirement_source','documentation_conflict','data','retryable','message','model_instruction','provider_body_sha256'}

def _message(status,products,conflict,relation):
    if status=='SUBSCRIPTION_REQUIRED':
        names=[NAMES[p]for p in products]
        if len(names)==1:msg='Для этого запроса Ozon требует подписку «'+names[0]+'».'
        elif names and relation=='ANY_OF':msg='Для этого запроса Ozon требует одну из подписок: '+', '.join(names)+'.'
        elif names:msg='Ozon указал требования к подписке: '+', '.join(names)+'. Соотношение этих требований нужно уточнить.'
        else:msg='Ozon требует подписку, но её название не подтверждено.'
        msg+=' Данные по запросу не получены.'
        if conflict:msg+=' Требование ответа площадки расходится с сохранённой документацией; необходима проверка у Ozon.'
        return msg
    if status=='METHOD_PERMISSION_REQUIRED':return 'Ozon отказал из-за недостаточных прав API-ключа для этого метода. Требование платной подписки этим ответом не подтверждено.'
    return 'Ozon отказал в доступе к запросу. Требование конкретной подписки в ответе не подтверждено; данные не получены.'

def build(diagnosis):
    if diagnosis.get('http')!=403 or diagnosis.get('provider_code')!=7:return None
    op=diagnosis.get('operation');reason=diagnosis.get('reason')
    if type(op)is not str or not re.fullmatch(r'(?:read\.ozon\.)?[A-Za-z0-9_]{1,120}',op):return None
    if reason not in ('OZON_PAID_SUBSCRIPTION_REQUIREMENT','OZON_METHOD_PERMISSION_REQUIREMENT','OZON_ACCESS_DENIED_UNSPECIFIED'):return None
    status={'OZON_PAID_SUBSCRIPTION_REQUIREMENT':'SUBSCRIPTION_REQUIRED','OZON_METHOD_PERMISSION_REQUIREMENT':'METHOD_PERMISSION_REQUIRED','OZON_ACCESS_DENIED_UNSPECIFIED':'ACCESS_DENIED'}[reason]
    products=diagnosis.get('provider_required_products',[])if status=='SUBSCRIPTION_REQUIRED'else[]
    if type(products)is not list or any(p not in NAMES for p in products):return None
    products=list(dict.fromkeys(products));relation='SINGLE'if len(products)==1 else diagnosis.get('provider_requirement_relation','UNRESOLVED')
    if relation not in ('SINGLE','ANY_OF','UNRESOLVED'):relation='UNRESOLVED'
    conflict=diagnosis.get('documentation_conflict')is True
    return {'schema':SCHEMA,'ok':False,'provider':'ozon','operation':op.removeprefix('read.ozon.'),'status':status,'http_status':403,'provider_code':7,
        'required_subscriptions':[{'id':p,'name':NAMES[p]}for p in products], 'subscription_relation':relation,'requirement_source':'provider_response','documentation_conflict':conflict,
        'data':None,'retryable':False,'message':_message(status,products,conflict,relation),'model_instruction':INSTRUCTION,'provider_body_sha256':diagnosis.get('body_sha256')}

def validate(value):
    if type(value)is not dict or set(value)!=FIELDS:return None
    if value['schema']!=SCHEMA or value['ok']is not False or value['provider']!='ozon' or value['http_status']!=403 or value['provider_code']!=7:return None
    if value['status']not in ('SUBSCRIPTION_REQUIRED','METHOD_PERMISSION_REQUIRED','ACCESS_DENIED')or value['data']is not None or value['retryable']is not False:return None
    if value['requirement_source']!='provider_response'or type(value['documentation_conflict'])is not bool or value['subscription_relation']not in('SINGLE','ANY_OF','UNRESOLVED'):return None
    if type(value['operation'])is not str or not re.fullmatch('[A-Za-z0-9_]{1,120}',value['operation']):return None
    if type(value['provider_body_sha256'])is not str or not re.fullmatch('[a-f0-9]{64}',value['provider_body_sha256']):return None
    products=value['required_subscriptions']
    if type(products)is not list or any(type(p)is not dict or set(p)!={'id','name'}or p['id']not in NAMES or p['name']!=NAMES[p['id']]for p in products):return None
    ids=[p['id']for p in products]
    if len(ids)!=len(set(ids))or(value['status']!='SUBSCRIPTION_REQUIRED'and ids):return None
    if value['message']!=_message(value['status'],ids,value['documentation_conflict'],value['subscription_relation'])or value['model_instruction']!=INSTRUCTION:return None
    return deepcopy(value)

def from_error(error):
    if getattr(error,'status',None)!=403 or not str(getattr(error,'code','')).startswith('HTTP_403'):return None
    feedback=getattr(error,'feedback',None)
    return validate(feedback.get('model_response'))if type(feedback)is dict else None

def stored(row):
    if row['state']!='FAILED'or not row['result']:return None
    try:result=json.loads(row['result']);return validate(result.get('model_response'))if type(result)is dict else None
    except(ValueError,TypeError):return None

def safe_provider_message(message):
    """Optional exact receipt only for an allowlisted generic provider phrase.

    This literal diagnostic text never becomes a model instruction. Opaque
    details/trace IDs and arbitrary provider strings are not exported.
    """
    if type(message)is not str or len(message)>400:return None
    words=re.findall(r'[A-Za-zА-Яа-яЁё]+',message.casefold())
    vocab=set('this the a an method function endpoint is are was only available allowed access denied to for of with without users user seller sellers account premium plus pro lite subscription subscriptions required requires require need needs active activated needed must have has be not no and or using you your please permission permissions management review reviews'.split())
    vocab.update('метод этот доступен доступ доступно только продавцам продавцов с без подпиской подписки подписка требуется необходима необходимо активная активной управление отзывами или и нет недостаточно прав'.split())
    if not words or any(w not in vocab for w in words):return None
    if re.search(r'[^A-Za-zА-Яа-яЁё\s.,:;!?\-«»"\'()]',message):return None
    return message
