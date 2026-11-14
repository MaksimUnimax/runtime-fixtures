"""Ephemeral current-value reads and value-free report publication fence.

No historical rows or serialized old coefficients. Save only the pins (target and
technical revisions) in the existing job; values are for current calculation.
A changed pin asks the existing job to re-evaluate using its already obtained
marketplace data. This module neither recollects nor authorizes report delivery.
"""
from copy import deepcopy
from django.db import transaction
from . import parameter_service as service
from .service import actor_store,need,Rejected
from .parameter_contract import ParameterError,CATALOG_HASH


def _pin(request,view):
    value=view['effective']
    return {'store_id':request['store_id'],'parameter':request['parameter'],
            'scope':deepcopy(request['scope']),'slot_revision':view['revision'],
            'effective':None if value is None else{'scope':deepcopy(value['scope']),
                'revision':value['revision'],'unit':value['unit'],'definition_hash':value['definition_hash']}}


def _requests(token,requests):
    need(type(requests)is list and requests and all(type(x)is dict for x in requests),'PARAMETER_SCHEMA',422)
    seen=set();result=[]
    # Stable store/parameter lock order, shared owner_data auth remains primary.
    for r in sorted(requests,key=lambda x:(str(x.get('store_id')),str(x.get('parameter')),str(x.get('scope')))):
        need(type(r)is dict and set(r)=={'store_id','parameter','scope','sku_reference'},'PARAMETER_SCHEMA',422)
        actor,store=actor_store(token,r['store_id'])
        try:service._target(actor,store,r['parameter'],r['scope'],r['sku_reference'])
        except ParameterError as e:raise Rejected(e.code,422)from None
        identity=(r['store_id'],r['parameter'],r['scope']['kind'],r['scope']['sku'])
        need(identity not in seen,'PARAMETER_DUPLICATE_DEPENDENCY',422);seen.add(identity)
        view=service._read(actor,store,r['parameter'],r['scope']);result.append((r,view))
    return result


@transaction.atomic
def read_current(token,requests):
    service._enabled();rows=_requests(token,requests)
    return {'schema':'alisa-parameter-readset/v1','definition_catalog_hash':CATALOG_HASH,
            'values':[{'store_id':r['store_id'],'parameter':r['parameter'],'scope':deepcopy(r['scope']),
                       'inherited':v['inherited'],'value':deepcopy(v['effective'])}for r,v in rows],
            'pins':[_pin(r,v)for r,v in rows],
            'missing':[_pin(r,v)for r,v in rows if v['effective']is None],
            'source_collection_started':False,'persist_values':False}


@transaction.atomic
def publication_fence(token,requests,pins,definition_catalog_hash):
    """Returns current revision match, never accepts pins as authorization."""
    service._enabled();need(type(pins)is list,'PARAMETER_SCHEMA',422)
    rows=_requests(token,requests);current=[_pin(r,v)for r,v in rows]
    changed=definition_catalog_hash!=CATALOG_HASH or pins!=current
    return {'schema':'alisa-parameter-publication/v1','current':not changed,
            'reason':'PARAMETERS_CHANGED'if changed else'CURRENT',
            'pins':current,'recollect_marketplace_data':False,
            'recalculate_with_current_parameters':changed,'old_values_stored':False}
