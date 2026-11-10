"""Idempotent inbox and product episodes. Raw questions are never accepted."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone as utc
import hashlib,hmac,math,uuid
from django.conf import settings
from django.db import transaction
from django.db.models import Count,Q
from django.utils import timezone
from alisa_platform.runtime_adapter.job_client import RuntimeFailure,need,identifier
from .models import Episode,Inbox,Coverage,Feedback
from .wire import canonical,event_shape,make_event,stamp,REASONS,REDACTOR,NORMALIZER,text_is_projection

def enabled():need(getattr(settings,'QUERY_INSIGHTS_ENABLED',False) is True,'CAPABILITY_UNAVAILABLE')
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def date(value):
    need(type(value)in {int,float}and math.isfinite(value)and value>=0,'VALIDATION_FAILED')
    try:return datetime.fromtimestamp(value,utc.utc)
    except (ValueError,OverflowError,OSError):raise RuntimeFailure('VALIDATION_FAILED')from None

def checked_event(value):
    try:
        event=deepcopy(event_shape(value))
        occurred=datetime.fromisoformat(event['occurred_at'])
        need(occurred<=timezone.now()+timedelta(minutes=5),'VALIDATION_FAILED')
        if event['redaction_state']=='TEXT_SAFE'and(event['redactor_version']!=REDACTOR or event['normalizer_version']!=NORMALIZER or not text_is_projection(event['safe_utterance'])):
            event.pop('safe_utterance',None);event['redaction_state']='METADATA_ONLY'
        return event
    except (ValueError,TypeError,KeyError,OverflowError,RecursionError):raise RuntimeFailure('VALIDATION_FAILED')from None

def save_event(original):
    """Caller holds a transaction and the producer/coverage serialization lock."""
    event=checked_event(original);mark=digest(original)
    old=Inbox.objects.filter(pk=event['event_id']).first()
    if old:
        need(old.payload_hash==mark,'VALIDATION_FAILED');return
    row=Episode.objects.select_for_update().filter(tenant_pseudonym=event['tenant_pseudonym'],logical_query_id=event['logical_query_id']).first()
    if row and row.revision==event['episode_revision']:need(row.revision_hash==mark,'VALIDATION_FAILED')
    if row is None:
        row=Episode(tenant_pseudonym=event['tenant_pseudonym'],logical_query_id=event['logical_query_id'])
    if row._state.adding or row.revision<event['episode_revision']:
        if not row._state.adding:
            previous=row.event
            if previous.get('p1_status')=='MISS':event['p1_status']='MISS'
            if event['redaction_state']=='METADATA_ONLY'and previous.get('redactor_version')==REDACTOR and text_is_projection(previous.get('safe_utterance')):
                event.update(redaction_state='TEXT_SAFE',safe_utterance=previous['safe_utterance'])
            event['occurred_at']=min(row.occurred_at,datetime.fromisoformat(event['occurred_at'])).isoformat()
        row.revision=event['episode_revision'];row.revision_hash=mark;row.producer=event['producer'];row.event=event
        row.reason=event['reason_code'];row.outcome=event['final_outcome'];row.internal_test=event['internal_test']
        row.occurred_at=datetime.fromisoformat(event['occurred_at']);row.save()
    elif event['episode_revision']<row.revision:
        previous=row.event;changed=False
        occurred=datetime.fromisoformat(event['occurred_at'])
        if occurred<row.occurred_at:
            row.occurred_at=occurred;previous['occurred_at']=occurred.isoformat();changed=True
        if event['p1_status']=='MISS'and previous['p1_status']!='MISS':previous['p1_status']='MISS';changed=True
        if event['redaction_state']=='TEXT_SAFE'and text_is_projection(event.get('safe_utterance'))and 'safe_utterance'not in previous:
            previous.update(redaction_state='TEXT_SAFE',safe_utterance=event['safe_utterance']);changed=True
        if changed:row.event=previous;row.save(update_fields=['event','occurred_at','received_at'])
    Inbox.objects.create(event_id=event['event_id'],payload_hash=mark)

@transaction.atomic
def ingest(payload):
    enabled();need(type(payload)is dict and set(payload)=={'events','coverage'},'VALIDATION_FAILED')
    events=payload['events'];coverage=payload['coverage']
    need(type(events)is list and len(events)<=16 and type(coverage)is dict,'VALIDATION_FAILED')
    need(set(coverage)=={'kind','stream_id','coverage_start','dropped','pending_bytes','oldest_pending_at','internal_test'},'VALIDATION_FAILED')
    need(type(coverage['kind'])is str and coverage['kind']in {'template_misses','terminal_outcomes'},'VALIDATION_FAILED')
    stream=identifier(coverage['stream_id']);start=date(coverage['coverage_start']);now=timezone.now()
    need(start<=now+timedelta(minutes=5)and type(coverage['internal_test'])is bool,'VALIDATION_FAILED')
    for name in ['dropped','pending_bytes']:need(type(coverage[name])is int and 0<=coverage[name]<=2**63-1,'VALIDATION_FAILED')
    oldest=None if coverage['oldest_pending_at']is None else date(coverage['oldest_pending_at'])
    # Serializes retries, duplicate events and concurrent stream initialization.
    from django.db import connection
    with connection.cursor()as cursor:cursor.execute('SELECT pg_advisory_xact_lock(%s)',[845073208])
    row=Coverage.objects.select_for_update().filter(pk=stream).first()
    if row:
        need(row.kind==coverage['kind']and row.coverage_start==start and row.internal_test==coverage['internal_test']and coverage['dropped']>=row.dropped,'VALIDATION_FAILED')
    else:row=Coverage(stream_id=stream,kind=coverage['kind'],coverage_start=start,internal_test=coverage['internal_test'])
    accepted=[]
    for event in events:
        safe=checked_event(event)
        need(safe['producer']=='analytics_runtime'and safe['internal_test']==coverage['internal_test']and safe['event_id']not in accepted,'VALIDATION_FAILED')
        save_event(event);accepted.append(safe['event_id'])
    row.dropped=coverage['dropped'];row.pending_bytes=coverage['pending_bytes'];row.oldest_pending_at=oldest;row.seen_at=now;row.save()
    return {'accepted':accepted,'stream_id':stream}

def selection(filters):
    need(type(filters)is dict and not set(filters)-{'reason','outcome','platform','from','to','include_internal','cursor'},'VALIDATION_FAILED')
    now=timezone.now();start=now-timedelta(days=7);end=now
    try:
        if 'from'in filters:start=datetime.fromisoformat(filters['from'])
        if 'to'in filters:end=datetime.fromisoformat(filters['to'])
        need(start.tzinfo is not None and end.tzinfo is not None and timedelta(0)<end-start<=timedelta(days=31),'VALIDATION_FAILED')
    except (ValueError,TypeError):raise RuntimeFailure('VALIDATION_FAILED')from None
    internal=filters.get('include_internal',False);need(type(internal)is bool,'VALIDATION_FAILED')
    rows=Episode.objects.filter(occurred_at__gte=start,occurred_at__lt=end)
    if not internal:rows=rows.filter(internal_test=False)
    for field,column,allowed in [('reason','reason',REASONS),('outcome','outcome',{'IN_PROGRESS','NEEDS_CLARIFICATION','READY','UNSUPPORTED','FAILED','CANCELED','REVOKED'}),('platform','event__platform',{'ozon','wb','both','unspecified'})]:
        if field in filters:
            need(type(filters[field])is str and filters[field]in allowed,'VALIDATION_FAILED');rows=rows.filter(**{column:filters[field]})
    all_rows=rows
    if 'cursor'in filters:
        cursor=all_rows.filter(pk=identifier(filters['cursor'])).first();need(cursor is not None,'VALIDATION_FAILED')
        rows=rows.filter(Q(occurred_at__lt=cursor.occurred_at)|Q(occurred_at=cursor.occurred_at,pk__lt=cursor.pk))
    coverage=Coverage.objects.all()if internal else Coverage.objects.filter(internal_test=False)
    states=list(coverage)
    complete={s.kind for s in states}=={'template_misses','terminal_outcomes'}and not all_rows.filter(outcome='IN_PROGRESS').exists()and all(s.coverage_start<=start and s.seen_at>=now-timedelta(minutes=3)and s.dropped==0 and s.pending_bytes==0 for s in states)
    return rows.order_by('-occurred_at','-id'),all_rows,{'from':start.isoformat(),'to':end.isoformat(),'complete':complete,
        'coverage_start':min((s.coverage_start for s in states),default=None),'dropped':sum(s.dropped for s in states),'pending_bytes':sum(s.pending_bytes for s in states)}

def journal(filters,*,export=False):
    enabled();rows,all_rows,coverage=selection(filters);limit=500 if export else 100;items=list(rows[:limit+1]);more=len(items)>limit
    if coverage['coverage_start']:coverage['coverage_start']=coverage['coverage_start'].isoformat()
    emitted=[];used=0
    for row in items[:limit]:
        item={'id':str(row.pk),**checked_event(row.event)};size=len(canonical(item).encode())
        if used+size>98304:more=True;break
        emitted.append(item);used+=size
    data={'items':emitted,'next_cursor':emitted[-1]['id']if more and emitted else None,
        'has_more':more,'coverage':coverage,'counts':list(all_rows.values('reason').annotate(count=Count('id'),clients=Count('tenant_pseudonym',distinct=True)).order_by('reason'))}
    if export:data['export_scope']='BOUNDED_SAFE_PROJECTION';data['truncated']=more
    return data

def wrong_semantics(principal,query_id):
    enabled()
    from alisa_platform.queries import service as queries
    answer=queries.read(principal,query_id,result=True,with_delivery_guard=True,record_useful=False)
    return record_feedback(principal,query_id,answer)

@transaction.atomic
def record_feedback(principal,query_id,answer):
    from alisa_platform.queries import service as queries
    row=queries.owned(principal,query_id,lock=True)
    result=answer.get('result',{})
    need(result.get('state')=='READY'and result.get('result_kind')=='DATA','VALIDATION_FAILED')
    guard=answer['delivery_guard'];guard.check()
    if Feedback.objects.filter(query=row).exists():return {'state':'ALREADY_RECORDED'}
    key=hmac.new(settings.SECRET_KEY.encode(),b'alisa-gap-feedback-v1',hashlib.sha256).digest()
    identity=str(row.pk)+'\0'+row.created_at.isoformat()+'\0'+row.input_hash
    event=make_event(key,str(row.tenant_id),identity,timezone.now().timestamp(),'MODEL_NO_TEMPLATE','unknown',{'runtime_release':settings.RELEASE,'original_question':None})
    event.update(producer='platform_feedback',trace_id=str(row.trace_id),reason_code='WRONG_SEMANTICS',final_outcome='READY',p1_status='NOT_ATTEMPTED')
    save_event(event)
    episode=Episode.objects.get(tenant_pseudonym=event['tenant_pseudonym'],logical_query_id=event['logical_query_id'])
    Feedback.objects.create(query=row,episode=episode)
    guard.check();queries.owned(principal,query_id)
    return {'state':'RECORDED'}
