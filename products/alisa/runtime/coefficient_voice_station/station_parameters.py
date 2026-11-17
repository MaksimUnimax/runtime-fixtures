"""Existing Station ingress/site; no extra listener, model call or OAuth family.

Cabinet consent is signed by the platform. Reverse proof checks use immutable
views: Station holds its normal ingress lock while the platform commits.
"""
from copy import deepcopy
from pathlib import Path
import hashlib,json,os,re,urllib.request,urllib.error
SCHEMA='alisa-station-parameter-authority/v1'
CATALOG=json.loads(Path(__file__).with_name('parameter_voice_catalog.json').read_text())

def enabled():return os.environ.get('ALISA_OWNER_PARAMETER_VOICE_ENABLED')=='1'
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def need(value):
    if not value:raise ValueError('station_parameter_boundary')

def snapshot(delivery):
    from station_authority import binding_id
    return {'owner':delivery.state.get('owner'),'binding':binding_id(delivery),
            'consent':deepcopy(delivery.state.get('parameter_consent'))}

def before_save(delivery):
    if getattr(delivery,'parameter_authority_view',None)!=snapshot(delivery):delivery.parameter_authority_view=None

def publish(delivery):
    value=snapshot(delivery)
    if getattr(delivery,'parameter_authority_view',None)!=value:delivery.parameter_authority_view=value

def permission(delivery):
    view=snapshot(delivery);consent=view['consent'] or {}
    ok=bool(enabled() and delivery.state.get('binding') and delivery.state.get('connected')
            and consent.get('binding')==view['binding'] and consent.get('grant'))
    return {'enabled':ok,'revision':consent.get('revision',0)}

def public_permission(delivery):return permission(delivery) if enabled() else None

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def platform(data):
    base=os.environ['ALISA_PLATFORM_URL'].rstrip('/')
    need(base in ('http://127.0.0.1:18102','http://127.0.0.1:18104'))
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();need(len(raw)<=16000)
    req=urllib.request.Request(base+'/api/v1/account/station-parameters',data=raw,
        headers={'Authorization':'Bearer '+os.environ['ALISA_AUTH_SERVICE_TOKEN'],'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=2) as response:
            raw=response.read(16001);need(response.status==200 and len(raw)<=16000)
    except urllib.error.HTTPError as error:
        if 400<=error.code<500:return {'rejected':True}
        raise ValueError('station_parameter_unavailable')from None
    result=json.loads(raw);need(type(result)is dict);return result

def set_permission(delivery,data,owner,session_token):
    need(enabled() and type(data)is dict and set(data)=={'enabled','expected_revision','confirmed'})
    need(type(data['enabled'])is bool and data['confirmed'] is True
         and type(data['expected_revision'])is int and data['expected_revision']>=0)
    with delivery.lock:
        need(delivery.state['owner']==owner and delivery.state.get('connected') and delivery.state.get('binding'))
        from station_authority import binding_id
        old=delivery.state.get('parameter_consent') or {};revision=old.get('revision',0)
        need(data['expected_revision']==revision and revision<2147483647)
        bound=binding_id(delivery);grant=None
        if data['enabled']:
            result=platform({'action':'grant','session_token':session_token,'binding':bound,
                             'permission_revision':revision+1,'confirmed':True})
            grant=result.get('grant');need(type(grant)is str and 1<=len(grant)<=4096)
        delivery.parameter_authority_view=None
        delivery.state['parameter_consent']={'binding':bound,'revision':revision+1,'grant':grant}
        delivery.state.pop('parameter_pending',None);delivery.parameter_request_view=None
        delivery.save();return delivery.view()

def cleanup_pending(delivery):
    value=delivery.state.get('parameter_pending')
    if value and value.get('expires',0)<=delivery.clock():
        with delivery.lock:
            if delivery.state.get('parameter_pending') is value:
                delivery.state.pop('parameter_pending',None);delivery.save()

def recognizes(command):
    text=re.sub(r'\s+',' ',command.strip().casefold())
    for verb in CATALOG['verbs']:
        if not text.startswith(verb+' '):continue
        rest=text[len(verb)+1:]
        if any(rest==alias or rest.startswith(alias+' ') for rule in CATALOG['parameters'].values() for alias in rule['aliases']):return True
    return False

def before(delivery,data,command,ticket):
    if not enabled():return None
    cleanup_pending(delivery);pending=delivery.state.get('parameter_pending')
    known=delivery.state.get('turn_receipts',{}).get(data.get('rid')) or {}
    if not recognizes(command) and not pending and not known.get('parameter_done'):return None
    if not permission(delivery)['enabled']:
        return {'reply':'Голосовая запись коэффициентов выключена. Включите её на странице «Моя колонка» в кабинете.'}
    turn=delivery.state.get('turn_receipts',{}).get(data.get('rid'))
    need(turn and ticket==turn['ticket'] and turn.get('conversation')==data.get('conversation'))
    need(type(data.get('message_id'))is int and 0<=data['message_id']<2**31)
    from station_authority import claims,binding_id
    if turn.get('parameter_done'):
        return {'reply':'Эта команда уже обработана. Актуальное значение доступно в кабинете.'}
    envelope=None
    if pending:
        if pending.get('conversation')!=data['conversation'] or pending.get('binding')!=binding_id(delivery):
            return {'reply':'Подтверждение относится к другой беседе. Продолжите исходную беседу или дождитесь истечения подтверждения.'}
        if pending.get('proposal_rid')==data['rid']:
            return {'reply':'Изменение подготовлено. Скажите «подтверждаю» или «отмена».'}
        try:envelope=delivery.cipher.decrypt(pending['cipher'].encode()).decode()
        except Exception:return {'reply':'Подтверждение недоступно. Проверьте текущее значение в кабинете.'}
    guard=claims(delivery,turn)
    body={'text':command,'pending':envelope,'message_id':data['message_id']}
    view={'guard':guard,'turn_hash':digest(body),'message_id':data['message_id'],
          'expires':delivery.clock()+10,'permission':delivery.parameter_authority_view}
    delivery.parameter_request_view=view
    try:
        result=platform({'action':'turn','guard':guard,'turn':body})
        if result.get('rejected'):
            delivery.state.pop('parameter_pending',None);delivery.save()
            return {'reply':'Изменение не подтверждено. Проверьте доступ и текущее значение в кабинете.'}
        response=result.get('skill_response');need(type(response)is dict and response.get('version')=='1.0')
        text=response['response']['text'];need(type(text)is str and 1<=len(text)<=1500)
        proposal=response['session_state'].get('parameter_write')
        need(proposal is None or type(proposal)is str and len(proposal)<=4096)
        need(delivery.parameter_authority_view is view['permission'])
        if proposal is not None:
            delivery.state['parameter_pending']={'cipher':delivery.cipher.encrypt(proposal.encode()).decode(),
                'expires':delivery.clock()+120,'conversation':data['conversation'],
                'proposal_rid':data['rid'],'binding':binding_id(delivery)}
        else:
            delivery.state.pop('parameter_pending',None);turn['parameter_done']=True
        delivery.save();return {'reply':text}
    except Exception:
        # Commit may exist. Retain the exact signed confirmation for explicit
        # recovery, never resend automatically or claim a rollback.
        return {'reply':'Не удалось подтвердить сохранение. Проверьте значение в кабинете. Автоматического повтора нет.'}
    finally:delivery.parameter_request_view=None

def authority(registry,value):
    from station_authority import authorize
    need(type(value)is dict and set(value)=={'op','guard','turn_hash'} and value['op']=='parameter_current')
    need(type(value['turn_hash'])is str and re.fullmatch('[a-f0-9]{64}',value['turn_hash'])is not None)
    guard=value['guard'];need(authorize(registry,{'op':'current','guard':guard})=={'allowed':True})
    deliveries=tuple(registry.users.values());found=[]
    for delivery in deliveries:
        view=getattr(delivery,'parameter_request_view',None);permission_view=getattr(delivery,'parameter_authority_view',None)
        if not view or not permission_view:continue
        consent=permission_view.get('consent') or {}
        if (view['guard']!=guard or view['turn_hash']!=value['turn_hash'] or view['expires']<=delivery.clock()
            or view['permission'] is not permission_view or not consent.get('grant')
            or consent.get('binding')!=permission_view['binding']):continue
        found.append((delivery,view,permission_view))
    need(len(found)==1 and enabled());delivery,view,permission_view=found[0];consent=permission_view['consent']
    result={'schema':SCHEMA,'allowed':True,'owner':guard['owner'],'native_tenant':guard['tenant'],
        'binding':permission_view['binding'],'permission_revision':consent['revision'],'grant':consent['grant'],
        'conversation':guard['conversation'],'message_id':view['message_id'],'turn_hash':value['turn_hash']}
    need(authorize(registry,{'op':'current','guard':guard})=={'allowed':True})
    need(tuple(registry.users.values())==deliveries and delivery.parameter_request_view is view
         and delivery.parameter_authority_view is permission_view and view['expires']>delivery.clock())
    return result
