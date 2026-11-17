"""Explicitly consented manual voice writes through the shared parameter writer.

reports:read authenticates identity ONLY. A current cabinet-issued consent is
required in addition; no WebSession is fabricated and OAuth scopes are unchanged.
Pending user input is a 120-second signed session envelope, not coefficient
history. No provider/model call, queue or background process exists here.
"""
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import re
import uuid

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Tenant
from alisa_platform.accounts.views import digest
from alisa_platform.alice_link.models import AliceLink, TokenFamily
from alisa_platform.alice_link.oauth import server, SCOPE, valid_link
from alisa_platform.stores.models import Store
from alisa_platform.stores.service import owned
from alisa_platform.queries.models import VoiceStorePreference
from . import parameter_service as parameters
from .parameter_contract import definition, validate_value, ParameterError
from .service import need, Rejected

CATALOG=json.loads(Path(__file__).with_name('parameter_voice_catalog.json').read_text())
SALT='alisa-parameter-voice-confirm/v1'
SCHEMA='alisa-parameter-voice-confirm/v1'
NAMESPACE=uuid.UUID('f760c3e6-9242-49dc-a8e2-5e6b13dd58b7')
TOKEN_ENDPOINT='https://alisa.octoport.ru/alice/oauth/token'
STATE_KEY='parameter_write'
AREA={'kind':'store','sku':''}


def enabled():
    return getattr(settings,'OWNER_PARAMETER_VOICE_ENABLED',False) is True


def permission(link):
    allowed=bool(link and link.parameter_write_consented_at is not None
                 and link.parameter_write_binding_revision==link.revision
                 and link.confirmed_at is not None and valid_link(link))
    return {'enabled':allowed,'revision':link.parameter_write_consent_revision if link else 0}


def consent(link, data):
    """Called only by the existing authenticated cabinet boundary under locks."""
    need(enabled(),'NOT_FOUND',404)
    need(transaction.get_connection().in_atomic_block,'OWNER_TRANSACTION_REQUIRED',503)
    need(set(data)=={'action','session_token','enabled','expected_revision','confirmed'},'PARAMETER_SCHEMA',422)
    need(type(data['enabled']) is bool and data['confirmed'] is True,'OWNER_CONFIRMATION_REQUIRED',422)
    need(type(data['expected_revision']) is int and data['expected_revision']>=0,'PARAMETER_REVISION',422)
    need(link is not None and valid_link(link) and link.confirmed_at is not None,'VOICE_LINK_REQUIRED',409)
    need(data['expected_revision']==link.parameter_write_consent_revision,'PARAMETER_REVISION_CONFLICT',409)
    link.parameter_write_consent_revision+=1
    link.parameter_write_binding_revision=link.revision if data['enabled'] else 0
    link.parameter_write_consented_at=timezone.now() if data['enabled'] else None
    link.save(update_fields=['parameter_write_consent_revision','parameter_write_binding_revision','parameter_write_consented_at'])
    return permission(link)


def _owner(token):
    need(type(token) is str and token.startswith('as6_') and len(token)<=2048,'AUTH_REQUIRED',401)
    candidate=TokenFamily.objects.filter(access_hash=digest(token)).values('link_id','link__customer_id','link__tenant_id').first()
    need(candidate is not None,'AUTH_REQUIRED',401)
    # Same serialization owner as OAuth revoke/unlink and cabinet mutations.
    Customer.objects.select_for_update().get(pk=candidate['link__customer_id'])
    Tenant.objects.select_for_update().get(pk=candidate['link__tenant_id'])
    link=AliceLink.objects.select_for_update().select_related('customer','tenant').get(pk=candidate['link_id'])
    valid, request=server().verify_request(TOKEN_ENDPOINT,http_method='POST',
        headers={'Authorization':'Bearer '+token},scopes=[SCOPE])
    need(valid and request.user.pk==link.pk and link.client_id==settings.ALICE_CLIENT_ID,'AUTH_REQUIRED',401)
    need(permission(link)['enabled'],'VOICE_PARAMETER_CONSENT_REQUIRED',403)
    return SimpleNamespace(customer=link.customer,customer_id=link.customer_id,
                           tenant=link.tenant,tenant_id=link.tenant_id),link


def _normalize(value):
    need(type(value) is str and len(value)<=1200,'PARAMETER_VOICE_INPUT',422)
    return re.sub(r'\s+',' ',value.strip().casefold()).rstrip('?!.,')


def parse(value):
    """Small declarative manual grammar; unknown reports are not intercepted."""
    text=_normalize(value)
    verb=next((v for v in CATALOG['verbs'] if text.startswith(v+' ')),None)
    if verb is None:return None
    rest=text[len(verb)+1:]
    found=[(key,rule,alias) for key,rule in CATALOG['parameters'].items()
           for alias in rule['aliases'] if rest==alias or rest.startswith(alias+' ')]
    if not found:return None
    key,rule,alias=max(found,key=lambda item:len(item[2]))
    tail=rest[len(alias)+1:]
    units='|'.join(re.escape(x) for x in rule['unit_words'])
    match=re.fullmatch(r'([0-9]{1,9}(?:[.,][0-9]{1,8})?)\s*(?:'+units+r')(?:\s+в магазине\s+(.{1,120}))?',tail)
    need(match is not None,'PARAMETER_VOICE_UNIT_REQUIRED',422)
    number=Decimal(match.group(1).replace(',','.'))*Decimal(rule['input_multiplier'])
    value=format(number,'f')
    if '.' in value:value=value.rstrip('0').rstrip('.')
    spec=definition(key);value=validate_value(spec,value,spec['unit'])
    return {'parameter':key,'value':value,'unit':spec['unit'],'store_hint':match.group(2)}


def _store(actor, hint, key):
    rows=list(Store.objects.filter(product_id='alisa_market',tenant_id=actor.tenant_id,status='ACTIVE',
                                   provider__in=definition(key)['platforms']).order_by('pk')[:51])
    need(len(rows)<=50,'VOICE_STORE_SELECTION_REQUIRED',409)
    if hint:
        rows=[row for row in rows if _normalize(hint) in {_normalize(row.name),_normalize(row.voice_alias)}]
    elif len(rows)!=1:
        pref=VoiceStorePreference.objects.filter(customer_id=actor.customer_id,tenant_id=actor.tenant_id).first()
        rows=[row for row in rows if pref is not None and row.pk==pref.store_id]
    need(len(rows)==1,'VOICE_STORE_SELECTION_REQUIRED',409)
    store=owned(actor,rows[0].pk)
    need(store.status=='ACTIVE' and bool(store.verified_identity),'OWNER_SOURCE_STORE_UNVERIFIED',409)
    return store


def _reply(text, pending=None):
    return {'version':'1.0','response':{'text':text,'end_session':False},
            'session_state':{STATE_KEY:pending}}


def _session(payload):
    session=payload.get('session')
    need(type(session) is dict and session.get('skill_id')==settings.ALICE_SKILL_ID,'WRONG_SKILL',403)
    sid=session.get('session_id');mid=session.get('message_id')
    need(type(sid) is str and 1<=len(sid)<=128 and not any(ord(c)<32 for c in sid),'PARAMETER_VOICE_SESSION',422)
    need(type(mid) is int and 0<=mid<2**31,'PARAMETER_VOICE_SESSION',422)
    return hashlib.sha256(sid.encode()).hexdigest(),mid


def _pending(payload):
    state=payload.get('state',{})
    if type(state) is not dict:return None
    session=state.get('session',{})
    return session.get(STATE_KEY) if type(session) is dict else None


def turn(actor,authority,original,pending,sid,mid,*,private=True):
    """Internal common turn; each transport supplies independently verified identity.

    Call only inside that transport's current authorization transaction. A raw
    customer ID or browser-supplied authority dictionary is never an entrypoint.
    """
    need(transaction.get_connection().in_atomic_block,'OWNER_TRANSACTION_REQUIRED',503)
    text=_normalize(original)
    parsed=parse(original) if not pending else None
    if parsed is None and not pending:return None
    if pending and text in {'отмена','отмени','нет'}:
        return _reply('Новое изменение отменено. Уже выполненное сохранение эта команда не откатывает.')
    if pending:
        need(type(pending) is str and len(pending)<=4096,'PARAMETER_VOICE_CONFIRMATION',422)
        try:intent=signing.loads(pending,salt=SALT,max_age=120)
        except (signing.BadSignature,ValueError,TypeError):raise Rejected('PARAMETER_VOICE_CONFIRMATION_EXPIRED',409)from None
        fields={'schema','customer','tenant','authority','session','message_id','store_revision','command'}
        need(type(intent) is dict and set(intent)==fields and intent['schema']==SCHEMA,'PARAMETER_VOICE_CONFIRMATION',422)
        need(intent['customer']==str(actor.customer_id) and intent['tenant']==str(actor.tenant_id)
             and intent['authority']==authority
             and intent['session']==sid and type(intent['message_id']) is int and mid>intent['message_id'],
             'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
        if text not in {'да','подтверждаю','сохрани'}:
            return _reply('Изменение не сохранено. Назовите коэффициент и значение заново.')
        command=intent['command'];need(type(command) is dict,'PARAMETER_SCHEMA',422)
        store=owned(actor,uuid.UUID(command['store_id']))
        need(store.revision==intent['store_revision'],'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
        result=parameters._manual_for_actor(actor,store,command)
        # No success is returned until the surrounding transaction commits.
        # Old receipt contains no old number; never speak stale value.
        if result.get('replayed') and result['receipt']['revision']!=result['revision']:
            return _reply('Эта команда уже была выполнена. После неё коэффициент изменили; в кабинете показано актуальное значение.')
        return _reply('Коэффициент сохранён для магазина «'+store.name+'». Изменение видно в кабинете.')
    store=_store(actor,parsed['store_hint'],parsed['parameter'])
    current=parameters._read(actor,store,parsed['parameter'],AREA)
    now=int(timezone.now().timestamp())
    command={'action':'set_manual','store_id':str(store.pk),'parameter':parsed['parameter'],
             'scope':dict(AREA),'sku_reference':None,'value':parsed['value'],'unit':parsed['unit'],
             'command_id':str(uuid.uuid5(NAMESPACE,json.dumps(authority,sort_keys=True)+':'+sid+':'+str(mid))),
             'expected_revision':current['revision'],'confirmed':True,'not_after':now+120}
    intent={'schema':SCHEMA,'customer':str(actor.customer_id),'tenant':str(actor.tenant_id),
            'authority':authority,
            'session':sid,'message_id':mid,'store_revision':store.revision,'command':command}
    signed=signing.dumps(intent,salt=SALT,compress=True)
    echo='указанное значение'
    if not private:
        rule=CATALOG['parameters'][parsed['parameter']]
        spoken=format(Decimal(parsed['value'])/Decimal(rule['input_multiplier']),'f')
        if '.' in spoken:spoken=spoken.rstrip('0').rstrip('.')
        echo=spoken.replace('.',',')+' '+rule['spoken_unit']
    return _reply('Сохранить '+echo+' для параметра «'+definition(parsed['parameter'])['label']+
                  '» магазина «'+store.name+'»? Скажите «подтверждаю» или «отмена».',signed)

def handle(token,payload):
    """Platform OAuth entry; Station has a separate verified binding entry."""
    if not enabled():return None
    need(type(payload)is dict and type(payload.get('request'))is dict,'PARAMETER_VOICE_INPUT',422)
    original=payload['request'].get('original_utterance',payload['request'].get('command',''))
    pending=_pending(payload)
    if not pending and parse(original) is None:return None
    with transaction.atomic():
        parameters._enabled();actor,link=_owner(token);sid,mid=_session(payload)
        authority={'kind':'PLATFORM_ALICE','id':str(link.pk),'revision':link.revision,
                   'permission_revision':link.parameter_write_consent_revision,
                   'security_revision':actor.customer.security_revision}
        return turn(actor,authority,original,pending,sid,mid,private=link.voice_private)



MESSAGES={
 'VOICE_PARAMETER_CONSENT_REQUIRED':'Запись коэффициентов голосом выключена. Включите её в настройках Алисы в кабинете.',
 'VOICE_STORE_SELECTION_REQUIRED':'Укажите точное имя магазина: в конце команды скажите «в магазине» и его название.',
 'PARAMETER_VOICE_UNIT_REQUIRED':'Укажите число и единицу: например, «установи коэффициент потерь 12 процентов».',
 'PARAMETER_REVISION_CONFLICT':'Коэффициент уже изменился в кабинете или другой командой. Назовите новое значение ещё раз.',
 'PARAMETER_VOICE_CONFIRMATION_EXPIRED':'Срок подтверждения истёк. Проверьте текущее значение в кабинете; прежняя запись автоматически не повторяется.',
 'PARAMETER_VOICE_CONFIRMATION_CHANGED':'Доступ, магазин или беседа изменились. Новая запись не выполнялась; проверьте текущее значение в кабинете.',
}

def dispatch(token,payload):
    try:return handle(token,payload)
    except (Rejected,ParameterError) as error:
        return _reply(MESSAGES.get(error.code,'Не удалось подтвердить сохранение коэффициента. Проверьте текущее значение и настройки в кабинете.'))
