"""Data-minimising product journal. Never an input to template selection.

The encrypted pilot evidence stays private. Only the explicit projection below
may cross the authority socket; uncertain text becomes METADATA_ONLY.
"""
import hashlib
import hmac
import json
import re
import unicodedata
from datetime import datetime, timezone
from uuid import UUID, uuid5, NAMESPACE_URL

SCHEMA='query_gap_v1'
REASONS=frozenset({'P1_MISS_P2_SUCCESS','SEMANTIC_UNSUPPORTED','OPERATOR_UNSUPPORTED',
    'NEEDS_CLARIFICATION','AMBIGUOUS_STORE_OR_PERIOD','DATA_UNAVAILABLE','PROVIDER_PLAN_REQUIRED',
    'AUTH_OR_SCOPE','SERVICE_ACCESS_REQUIRED','RATE_LIMIT_OR_PROVIDER_ERROR','PARSER_OR_RUNTIME_BUG',
    'SECURITY_OR_ABUSE','WRONG_SEMANTICS'})
FINAL=frozenset({'IN_PROGRESS','NEEDS_CLARIFICATION','READY','UNSUPPORTED','FAILED','CANCELED','REVOKED'})
FIELDS=frozenset({'schema_version','event_id','producer','occurred_at','trace_id','logical_query_id',
    'episode_revision','tenant_pseudonym','pseudonym_key_version','platform','p1_status','p2_status',
    'reason_code','final_outcome','semantic_axis','redaction_state','slot_types','normalizer_version',
    'redactor_version','catalog_version','runtime_version','access_basis_at_event','internal_test'})
NORMALIZER='gap-normalizer-v1'
REDACTOR='gap-redactor-v1'
SAFE_CAPITALS=frozenset('Покажи Покажите Сравни Сравните Как Какой Какая Какие Сколько Выручка Оборот Продажи Заказы Выкупы Остатки Расходы Озон Вайлдберриз Ozon WB FBO FBS DRR ДРР'.split())
WORDS=frozenset(('покажи покажите сравни сравните рассчитай посчитай сколько какой какая какие как почему что где когда '
    'в во не ни нет из к ко у о об обо для над под при после перед между это их именно нужно нужны требуется а '
    'конверсия конверсию конверсии покупка покупок покупки повторные повторных повторно просмотры просмотров показы показов '
    'клики кликов корзина корзину корзины карточки карточку карточке отправления отгрузки отгрузка фактическая фактическую '
    'фактически реализовано возвращено отменено заказам заказами выкупам выкупами выкупах произошли состоялись начислили '
    'за на по от до с со без и или но кроме только все всех каждый каждого отдельно вместе общая общий средняя средний среднюю '
    'цена цену цены реализации продажи продаж продажам заказ заказы заказов выкупы выкупов выкупили заказали оборот выручка '
    'выручку сумма сумму количество единиц штук товар товары товаров товарные начисления начислений начислено удержания '
    'удержаний комиссия комиссии логистика логистики расходы расход расходами расходам затраты затрат реклама рекламу рекламы '
    'рекламные рекламных кампании кампаниям бюджет бюджета дrr drr дрр доля процент процентов маржа прибыль прибыли себестоимость '
    'себестоимости остатки остатков запас поставка поставки возвраты возвратов отмены отменам отмен доставки доставок '
    'дата дате даты продажи заказа выкупа события начисления вчера сегодня позавчера неделю неделе неделям месяц месяце '
    'месяцам год года году дням день дней период периода заказывали выкупили оплатили покупатель покупателя покупателю '
    'покупатели покупателям карта карте карты озон ozon wb вайлдберриз fbo fbs магазин магазина магазинам магазинов '
    'разница разницу сравнение относительно предыдущего прошлого текущего прошлый текущий рост падение больше меньше '
    'выше ниже топ максимум минимум среднее средней средних динамика разбивка группировка').split())
SENSITIVE=re.compile(r'(?i)(?:api[ _-]?key|client[ _-]?id|bearer|парол\w*|токен\w*|секрет\w*|ключ\w*)')
OPAQUE=re.compile(r'[A-Za-z0-9_+/=.-]{16,}')

def canonical(value):return json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':'))
def stamp(value):return datetime.fromtimestamp(value,timezone.utc).isoformat()
def uuid(value):return str(UUID(value))==value
def private_hash(key,purpose,value):
    subkey=hmac.new(key,b'alisa-gap-diagnostics-subkey-v1',hashlib.sha256).digest()
    return hmac.new(subkey,(purpose+'\0'+value).encode(),hashlib.sha256).hexdigest()

def safe_text(value):
    """Conservative redaction, independent of the model and current templates."""
    if type(value)is not str or not 1<=len(value)<=1200:return None,[]
    value=unicodedata.normalize('NFKC',value)
    if SENSITIVE.search(value)or any(unicodedata.category(c).startswith('C')for c in value)or any(c in value for c in '<>{}[]'):
        return None,[]
    slots=[]
    value=re.sub(r'https?://\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[\w-]+','<КОНТАКТ>',value,flags=re.I)
    value=re.sub(r'["«“].*?["»”]','<ЗНАЧЕНИЕ>',value)
    value=re.sub(r'\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b','<ПЕРИОД>',value)
    if '<ПЕРИОД>'in value:slots.append('period')
    value=OPAQUE.sub('<ИДЕНТИФИКАТОР>',value)
    value=re.sub(r'(?<!\w)\+?\d[\d ()-]{5,}\d(?!\w)','<ЧИСЛО>',value)
    value=re.sub(r'\d+(?:[.,]\d+)?','<ЧИСЛО>',value)
    # Money written in words is deliberately not guessed by a language model.
    if re.search(r'(?i)рубл|доллар|евро|миллион|миллиард|тысяч|₽|[$€]',value):return None,['amount_placeholder']
    def names(match):
        word=match[0]
        if word.startswith('<'):return word
        return word if word.lower()in WORDS or word in SAFE_CAPITALS else '<ФРАГМЕНТ>'
    value=re.sub(r'(?u)<[^>]+>|\b[^\W\d_]+\b',names,value)
    value=re.sub(r'(?:<ФРАГМЕНТ>\s*){2,}','<ФРАГМЕНТ> ',value)
    value=' '.join(re.findall(r'(?u)<[^>]+>|\b[^\W\d_]+\b|[?,.!:;()-]',value))
    # Short mixed identifiers and SKU-like values may not be ordinary prose.
    if re.search(r'(?u)\b\w*\d\w*\b',value)or len(value)>1000:return None,slots
    value=' '.join(value.split())
    if not re.sub(r'<[^>]+>|[\W_]','',value):return None,slots
    return (value if value else None),slots

def event_shape(value):
    """Closed wire shape. No raw context, model output or arbitrary extra fields."""
    if type(value)is not dict:raise ValueError('GAP_SCHEMA')
    required=FIELDS|({'safe_utterance'}if value.get('redaction_state')=='TEXT_SAFE'else set())
    if set(value)!=required or value.get('schema_version')!=SCHEMA or value.get('producer')not in {'analytics_runtime','platform_feedback','platform_observer'}:raise ValueError('GAP_SCHEMA')
    for name in ['event_id','trace_id','logical_query_id']:
        if type(value[name])is not str or not uuid(value[name]):raise ValueError('GAP_SCHEMA')
    if type(value['episode_revision'])is not int or not 1<=value['episode_revision']<=2147483647:raise ValueError('GAP_SCHEMA')
    if not re.fullmatch('[a-f0-9]{64}',value['tenant_pseudonym']):raise ValueError('GAP_SCHEMA')
    for name in ['pseudonym_key_version','normalizer_version','redactor_version','catalog_version','runtime_version']:
        item=value[name]
        maximum=128 if name in {'catalog_version','runtime_version'}else 64
        if type(item)is not str or len(item)>maximum or not re.fullmatch(r'[A-Za-z0-9_.:-]+',item):raise ValueError('GAP_SCHEMA')
    if value['reason_code']not in REASONS or value['final_outcome']not in FINAL:raise ValueError('GAP_SCHEMA')
    if value['reason_code']=='P1_MISS_P2_SUCCESS'and(value['p1_status'],value['p2_status'],value['final_outcome'])!=('MISS','SUCCESS','READY'):raise ValueError('GAP_SCHEMA')
    if value['platform']not in {'ozon','wb','both','unspecified'}or value['p1_status']not in {'MATCH','MISS','NOT_ATTEMPTED'}or value['p2_status']not in {'NOT_ATTEMPTED','PENDING','SUCCESS','FAILED'}:raise ValueError('GAP_SCHEMA')
    if value['semantic_axis']not in {'order_date','event_date','accrual_date','snapshot','unspecified'}or value['redaction_state']not in {'TEXT_SAFE','METADATA_ONLY'}:raise ValueError('GAP_SCHEMA')
    if value['access_basis_at_event']not in {'PAYMENT','GIFT','COMPENSATION','NONE','UNKNOWN'}or type(value['internal_test'])is not bool:raise ValueError('GAP_SCHEMA')
    slots=value['slot_types']
    if type(slots)is not list or len(slots)>20 or any(type(s)is not str or s not in {'period','store','product','brand','grouping','exclusion','comparison','top_n','amount_placeholder'}for s in slots):raise ValueError('GAP_SCHEMA')
    if value['redaction_state']=='TEXT_SAFE':
        text=value['safe_utterance']
        if type(text)is not str or not 1<=len(text)<=1000 or any(unicodedata.category(c).startswith('C')for c in text):raise ValueError('GAP_SCHEMA')
    date=datetime.fromisoformat(value['occurred_at'])
    if date.tzinfo is None or date.utcoffset().total_seconds()!=0:raise ValueError('GAP_SCHEMA')
    if len(canonical(value).encode())>8192:raise ValueError('GAP_SCHEMA')
    return value

def make_event(key,tenant,jid,created,reason,catalog_hash,payload,*,internal_test=False):
    identity=private_hash(key,'gap-episode-v1',tenant+'\0'+jid)
    ident=str(uuid5(NAMESPACE_URL,'alisa-gap-episode-v1:'+identity))
    classifications={'MODEL_NO_TEMPLATE':'SEMANTIC_UNSUPPORTED','TEMPLATE_CONDITIONS_NOT_SUPPORTED':'OPERATOR_UNSUPPORTED',
        'INVALID_PERIOD':'AMBIGUOUS_STORE_OR_PERIOD','MISSING_PERIOD':'NEEDS_CLARIFICATION'}
    code=classifications.get(reason,'PARSER_OR_RUNTIME_BUG')
    final='IN_PROGRESS'  # A saved pilot case is not proof that terminal commit succeeded.
    text,slots=safe_text(payload.get('original_question'))
    event={'schema_version':SCHEMA,'event_id':str(uuid5(NAMESPACE_URL,'alisa-gap-event-v1:'+identity+':1')),
        'producer':'analytics_runtime','occurred_at':stamp(created),'trace_id':ident,'logical_query_id':ident,
        'episode_revision':1,'tenant_pseudonym':private_hash(key,'gap-tenant-v1',tenant),
        'pseudonym_key_version':private_hash(key,'gap-key-version-v1','')[:32],
        'platform':'unspecified','p1_status':'MISS','p2_status':'NOT_ATTEMPTED','reason_code':code,'final_outcome':final,
        'semantic_axis':'unspecified','redaction_state':'TEXT_SAFE'if text else'METADATA_ONLY','slot_types':slots,
        'normalizer_version':NORMALIZER,'redactor_version':REDACTOR,'catalog_version':catalog_hash,
        'runtime_version':payload.get('runtime_release','unknown'),'access_basis_at_event':'UNKNOWN','internal_test':internal_test}
    if text:event['safe_utterance']=text
    return event_shape(event)

def text_is_projection(value):
    """Consumer-side lexical closure; unknown redactors never earn text access."""
    if type(value)is not str or not 1<=len(value)<=1000:return False
    remaining=re.sub(r'<(?:КОНТАКТ|ЗНАЧЕНИЕ|ПЕРИОД|ИДЕНТИФИКАТОР|ЧИСЛО|ФРАГМЕНТ)>',' ',value)
    if any(c in remaining for c in '<>')or SENSITIVE.search(remaining)or OPAQUE.search(remaining):return False
    if any(unicodedata.category(c).startswith('C')or c.isdigit()for c in remaining):return False
    if any(not(c.isalpha()or c.isspace()or c in '?,.!:;()-')for c in remaining):return False
    return all(word.lower()in WORDS or word in SAFE_CAPITALS for word in re.findall(r'(?u)\b[^\W\d_]+\b',remaining))
