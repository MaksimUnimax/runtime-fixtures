"""Bridge from existing authenticated job results to current-only parameter store.

No new worker, credentials, background timer or HTTP collector. The runtime must
supply qualified batches and its current-source verifier. Mutation authorization
is freshly checked by the existing platform service; a read-report bearer does
not become an owner-write grant here.
"""
from copy import deepcopy
import json
from django.db import transaction
from django.utils import timezone
from . import parameter_service as service
from .service import actor_store,need,Rejected
from .parameter_contract import ParameterError,validate_calculation
from .parameter_producers import produce


def finish_sources(session_token,command,period,batches,*,verify_source,as_of,preview=False):
    """Finish a job with a fresh, explicit commit command or preview only.

    The original expected_revision and command_id must come from admitted intent,
    never from the model or a last-second read intended to evade a conflict.
    Supplying only JSON complete=true is insufficient: verify_source must resolve
    real existing source/job receipts and current access, independent of the LLM.
    """
    service._enabled()
    with transaction.atomic():
        actor,store=actor_store(session_token,command['store_id'])
        service._target(actor,store,command['parameter'],command['scope'],command['sku_reference'])
        target={'tenant_id':str(actor.tenant_id),'store_id':str(store.pk),'provider':store.provider,'scope':deepcopy(command['scope'])}
        if not preview:
            need(command['action']in('fill_missing','replace_calculated')and command['confirmed']is True,'OWNER_CONFIRMATION_REQUIRED',422)
            current=service._read(actor,store,command['parameter'],command['scope'])
            if command['action']=='fill_missing'and current['effective']is not None:
                return {**current,'written':False,'reason':'ALREADY_PRESENT','sources_reduced':False}
    # Data reduction outside DB locks. This does not make a model/API request.
    try:
        candidate=produce(command['parameter'],target,period,batches,verify=verify_source,as_of=as_of,now=timezone.now())
        envelope=json.loads(candidate.envelope_json)
        if preview:
            with transaction.atomic():
                actor,store=actor_store(session_token,command['store_id'])
                service._target(actor,store,command['parameter'],command['scope'],command['sku_reference'])
                need(str(actor.tenant_id)==target['tenant_id'],'OWNER_SOURCE_AUTH_CHANGED',403)
                checked=validate_calculation(candidate.key,envelope,target,period,timezone.now(),candidate.verify)
                return {'preview':True,'written':False,'value':checked.value,'unit':checked.unit,
                        'calculated_at':checked.calculated_at.isoformat(),'collected_at':checked.collected_at.isoformat(),
                        'period':json.loads(checked.actual_json),'evidence':json.loads(checked.evidence_json)}
        return service.commit_calculated(session_token,command,envelope,period,verify_sources=candidate.verify)
    except ParameterError as e:raise Rejected(e.code,422)from None
    finally:
        # The caller's current job retains raw sources only under its existing
        # transient retention. No second coefficient archive or old-value cache.
        candidate=None
