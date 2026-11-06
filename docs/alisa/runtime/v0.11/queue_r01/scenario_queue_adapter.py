"""Trusted pure adapter for previously qualified scenario envelopes.

Consumes two source DTOs and a pinned owner/context snapshot. It does not perform
HTTP, create authority, normalize raw marketplace responses or install a route.
The integration authority must attest the exact inputs and current permissions.
"""
from pathlib import Path
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json

from semantics import Rejected, canonical_json, fingerprint
from scenario_bindings import ScenarioBindings, BindingError
from owner_inputs import InputError
from report_contracts import ContractError
from matrix_core import MatrixError

ROOT = Path(__file__).parent


def require(ok, code):
    if not ok:
        raise Rejected(code)


class ScenarioQueueAdapter:
    def __init__(self, authorize, scenario=None, owner=None, gates=None, voice=None):
        self.scenario = deepcopy(scenario or json.loads((ROOT/'scenario_catalog.json').read_text()))
        self.owner = deepcopy(owner or json.loads((ROOT/'owner_input_catalog.json').read_text()))
        self.gates = deepcopy(gates or json.loads((ROOT/'scenario_report_catalog.json').read_text()))
        self.runtime = ScenarioBindings(self.scenario, self.owner, self.gates)
        self.authority = authorize
        self.voice = deepcopy(voice or json.loads((ROOT/'scenario_voice_catalog.json').read_text()))
        require(self.voice.get('schema') == 'alice-scenario-voice/v1', 'GRAPH_VOICE_CATALOG')
        self.policy_hash=fingerprint({'scenario':self.scenario,'owner':self.owner,'gates':self.gates,'voice':self.voice})
        self.pin = fingerprint({'adapter': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                                'scenario': self.runtime.hash, 'code': self.runtime.code_hash,
                                'owner': self.runtime.owner.hash, 'voice': self.voice})

    def _authorize(self, kind, subject, plan, action):
        require(callable(self.authority), 'GRAPH_ADAPTER_AUTH_REQUIRED')
        try:
            accepted = self.authority(kind, deepcopy(subject), deepcopy(plan), action)
        except Exception:
            raise Rejected('GRAPH_ADAPTER_AUTH_UNAVAILABLE') from None
        require(accepted is True, 'GRAPH_ADAPTER_AUTH_DENIED')
        return True

    def authorize_plan(self, plan, now, action):
        try:
            require(self.policy_hash==fingerprint({'scenario':self.scenario,'owner':self.owner,'gates':self.gates,'voice':self.voice}),
                    'GRAPH_ADAPTER_POLICY_CHANGED')
            inputs=plan['graph_inputs']['payload']
            require(type(inputs) is dict and set(inputs)=={'owner','context'}, 'GRAPH_SCENARIO_INPUT_SCHEMA')
            owner=inputs['owner'];ctx=inputs['context']
            require(type(owner) is dict and set(owner)=={'payload','sha256'}
                    and owner['sha256']==fingerprint(owner['payload']), 'GRAPH_SCENARIO_ENVELOPE')
            require(type(owner['payload']['expires_at']) is int and now<owner['payload']['expires_at'],
                    'GRAPH_RESULT_EXPIRED')
            require(ctx['period']==plan['period'] and ctx['currency']==plan['stores'][0]['currency'], 'GRAPH_SCENARIO_SCOPE')
            return self._authorize('owner_plan',{'owner_hash':owner['sha256'],'context_hash':fingerprint(ctx),
                                                'adapter_pin':self.pin},plan,action)
        except (Rejected,TypeError,KeyError,ValueError):
            return False

    def expiry(self, value, plan):
        deadline=value['valid_until']
        require(type(deadline) is int and deadline<=plan['task_graph']['deadline'], 'GRAPH_RESULT_EXPIRED')
        return deadline

    def _envelope(self, outputs, name):
        block = outputs.get(name)
        require(type(block) is dict and block.get('complete') is True and
                type(block.get('rows')) is list and len(block['rows']) == 1,
                'GRAPH_SCENARIO_INPUT_INCOMPLETE')
        row = block['rows'][0]
        require(type(row) is dict and set(row) == {'key', 'value'}, 'GRAPH_SCENARIO_ROW')
        value = row['value']
        require(type(value) is dict and set(value) == {'payload', 'sha256'} and
                value['sha256'] == fingerprint(value['payload']), 'GRAPH_SCENARIO_ENVELOPE')
        return deepcopy(value)

    def execute(self, plan, inputs, outputs, now):
        require(set(inputs) == {'owner', 'context'}, 'GRAPH_SCENARIO_INPUT_SCHEMA')
        require(set(outputs) == {'cohort', 'expenses'}, 'GRAPH_SCENARIO_SOURCE_SET')
        cohort = self._envelope(outputs, 'cohort')
        expenses = self._envelope(outputs, 'expenses')
        owner, context = deepcopy(inputs['owner']), deepcopy(inputs['context'])
        require(context['period'] == plan['period'] and
                context['currency'] == plan['stores'][0]['currency'], 'GRAPH_SCENARIO_SCOPE')
        def authorize(kind, metadata, ctx, action):
            return self._authorize(kind, {'metadata': metadata, 'context': ctx}, plan, action)
        def owner_authorize(metadata, request, action):
            return self._authorize('owner', {'metadata': metadata, 'request': request}, plan, action)
        options = {'authorize': authorize, 'owner_authorize': owner_authorize, 'now': int(now)}
        try:
            pin = self.runtime.prepare(cohort, expenses, owner, context, **options)
            result = self.runtime.execute(pin, cohort, expenses, owner, context, **options)
        except (BindingError, InputError, ContractError, MatrixError) as exc:
            raise Rejected(exc.code) from None
        require(result['status'] == 'CALCULATED', 'GRAPH_SCENARIO_BLOCKED')
        # The source snapshots already remain in the one job checkpoint until
        # publication. Only the result and its pinned identifiers survive READY.
        expiries=[cohort['payload']['expires_at'],expenses['payload']['expires_at'],
                  owner['payload']['expires_at'],plan['task_graph']['deadline']]
        expiries.extend(record['observation']['expires_at'] for records in expenses['payload']['scenarios'].values()
                        for record in records)
        require(all(type(x) is int for x in expiries) and min(expiries)>now,'GRAPH_RESULT_EXPIRED')
        output = {'schema': 'alice-queued-scenario/v1', 'adapter_pin': self.pin,
                  'valid_until': min(expiries),
                  'scenario_pin': pin, 'input_hash': plan['task_graph']['input_hash'],
                  'result': result}
        output['sha256'] = fingerprint(output)
        return output

    def check(self, value, plan, now):
        try:
            require(type(value) is dict and set(value) ==
                    {'schema','adapter_pin','scenario_pin','input_hash','result','valid_until','sha256'},
                    'GRAPH_SCENARIO_RESULT_SCHEMA')
            require(value['schema'] == 'alice-queued-scenario/v1' and
                    value['adapter_pin'] == self.pin and
                    value['input_hash'] == plan['task_graph']['input_hash'] and
                    value['sha256'] == fingerprint({k:v for k,v in value.items() if k != 'sha256'}),
                    'GRAPH_SCENARIO_RESULT_CHANGED')
            require(self.authorize_plan(plan,now,'read') and self.expiry(value,plan)>now,'GRAPH_RESULT_EXPIRED')
            result = value['result']
            require(result['status'] == 'CALCULATED' and
                    result['result_sha256'] == fingerprint({k:v for k,v in result.items()
                                                           if k != 'result_sha256'}),
                    'GRAPH_SCENARIO_RESULT_CHANGED')
            require(set(result['scenarios']) == set(self.scenario['scenarios']),
                    'GRAPH_SCENARIO_RESULT_SCHEMA')
            self._authorize('result', {'pin': value['scenario_pin'],
                                      'input_hash': value['input_hash']}, plan, 'read')
            return True
        except (Rejected, KeyError, TypeError, ValueError):
            return False

    def render(self, value, stamp):
        def amount(raw):
            if raw is None:
                return 'не определено'
            n = Decimal(raw)
            require(n.is_finite(), 'NUMBER_RANGE')
            return format(n.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), 'f')
        labels = {k:v['label'] for k,v in self.scenario['sources'].items()}
        labels.update({k:v['label'] for k,v in self.scenario['owner_bindings'].items()})
        labels.update(self.voice['labels'])
        lines = []
        for scenario in value['result']['scenarios'].values():
            lines.append(scenario['label'] + '.')
            for row in scenario['rows']:
                require(row['component'] in labels, 'GRAPH_SCENARIO_LABEL_MISSING')
                basis = row['provenance']['basis']
                lines.append(labels[row['component']] + ': ' + amount(row['total']) +
                             ' RUB; основание ' + self.voice['basis_labels'].get(basis,basis) + '.')
            subtotal = scenario['subtotal']
            lines.append('Остаток после включённых затрат: ' + amount(subtotal['total']) +
                         ' RUB. На исходно заказанную единицу: ' + amount(subtotal['per_original_unit']) +
                         ' RUB; знаменатель ' + subtotal['original_unit_denominator'] + '.')
            omitted = scenario['eligibility']['omissions']
            if omitted:
                lines.append('Не включены: ' + ', '.join(x['component'] + ' (' + x['state'] + ')'
                                                       for x in omitted) + '.')
        lines.append('Это сценарный остаток, не чистая прибыль. Факт и оценка указаны отдельно. Получено ' + stamp + '.')
        pages, buffer = [], ''
        for line in lines:
            require(type(line) is str and len(line) <= 760, 'GRAPH_SCENARIO_VOICE_LINE')
            if buffer and len(buffer) + len(line) + 1 > 780:
                pages.append(buffer)
                buffer = ''
            buffer += (' ' if buffer else '') + line
        if buffer:
            pages.append(buffer)
        for i in range(len(pages)-1):
            pages[i] += ' Скажите: дальше.'
        return pages
