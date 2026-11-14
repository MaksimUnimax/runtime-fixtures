"""Declarative parameter dependency plan, not a second queue or provider client.

The current template executor consumes the returned producer request through its
existing job/authority boundary. This planner cannot execute or persist anything.
"""
from copy import deepcopy
from .parameter_contract import definition,resolve_period,need


def plan_parameter(key,current,today,*,action='use',period_request=None,
                   available_from=None,short_history_confirmed=False):
    rule=definition(key)
    need(action in('use','status','preview','recalculate'),'PARAMETER_ACTION')
    need(type(current)is dict and current.get('parameter')==key,'PARAMETER_SCHEMA')
    effective=current.get('effective')
    if action=='status':
        return {'action':'current_status','parameter':key,'value':deepcopy(effective),
                'inherited':current['inherited'],'collect':False,'persist':False}
    if action=='use'and effective is not None:
        # Zero and old collection dates stay valid; report date/age is irrelevant.
        return {'action':'use_current','parameter':key,'value':deepcopy(effective),
                'inherited':current['inherited'],'collect':False,'persist':False}
    area=deepcopy(current['scope'])
    # A report for one SKU never creates an individual coefficient implicitly.
    if action=='use'and area['kind']=='sku':area={'kind':'store','sku':''}
    period=resolve_period(today,period_request,available_from,short_history_confirmed)
    intent='fill_missing'if action=='use'else'replace_calculated'if action=='recalculate'else'preview'
    return {'action':'producer_required','template_id':rule['producer_template'],'parameter':key,
            'store_id':current['store_id'],'scope':area,'parameter_period':period,
            'write_intent':intent,'collect':True,'persist':intent!='preview',
            'expected_revision':current['revision']if area==current['scope']else None,
            'read_target_revision_before_collection':area!=current['scope']}
