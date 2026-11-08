"""Network-free ingress facade and one-step worker with injectable transport."""
from __future__ import annotations
from dataclasses import asdict
from datetime import date, datetime, timezone
from typing import Callable
from pathlib import Path
from semantics import (Rejected, Scope, Store, parse, make_plan, fingerprint,
                       strict_json, canonical_json, plan_authorized, validate_model)
from repository import Repository, Deferred
from semantic_catalog import EXPRESSION_CATALOG,validate_catalog
from query_program import make_composed_plan,validate_compiled,validate_model_program,validate_catalog_typed,explain_program,LANGUAGE,PROJECTION
from registry import REGISTRY_HASH
from request_basis import validate_request_basis, POLICY_VERSION, CLARIFICATION
import providers
from matrix_core import MatrixError

HELP = ('Доступны заказы, расход рекламы и ДРР от заказов. Для WB — воронка и выкупы по заказам периода. Также доступны финансовая сводка за период и текущие остатки на складах площадки. Пример: ДРР за октябрь 2026 на Озоне. '
        'Для получения отчета: результат. Для обновления: обнови и исходный запрос.')

class CallError(Exception):
    def __init__(self,code,status=None,unknown=False,retry_at=None):
        self.code,self.status,self.unknown,self.retry_at = code,status,unknown,retry_at
        super().__init__(code)

def validate_model_budget(value):
    if (not isinstance(value,dict) or set(value)!={'schema','daily_calls','min_interval_seconds'}
        or value['schema']!='alice-model-budget/v1' or type(value['daily_calls']) is not int
        or not 1<=value['daily_calls']<=100 or type(value['min_interval_seconds']) is not int
        or not 2<=value['min_interval_seconds']<=3600):raise Rejected('MODEL_BUDGET_SCHEMA')
    return dict(value)

class Engine:
    def __init__(self,repository: Repository,scope_for: Callable[[str], Scope],catalog=None,table_capabilities=None,dataset_capabilities=None):
        self.repo,self.scope_for = repository,scope_for
        self.table_capabilities=table_capabilities
        self.dataset_capabilities=dataset_capabilities
        self.catalog=validate_catalog_typed(catalog or EXPRESSION_CATALOG)
        self.model_budget=validate_model_budget(strict_json(Path(__file__).with_name('resource_limits.json').read_text()))
        from dialogue import ensure_schema
        ensure_schema(self.repo)
        from retention import install
        install(self.repo)

    def authorized(self,plan):
        try:
            scope = self.scope_for(plan['tenant'])
            if not plan_authorized(plan,scope): return False
            if 'program' in plan and not validate_compiled(plan):return False
            if 'dataset' in plan:
                from dataset_pipeline import valid
                if not valid(plan) or self.dataset_capabilities is None:return False
                caps=self.dataset_capabilities()
                if any(caps.get(sid,{}).get(op)!=proof for sid,ops in plan['dataset_capabilities'].items() for op,proof in ops.items()):return False
            if 'table' in plan:
                from table_analytics import valid
                if not valid(plan) or self.table_capabilities is None:return False
                caps=self.table_capabilities()
                if any(caps.get(sid,{}).get(op)!=proof for sid,operations in plan['table_capabilities'].items() for op,proof in operations.items()):return False
            return not any(self.repo.denied(source,s['access_revision']) for s in plan['stores'] for source in providers.sources(plan,s))
        except (Rejected,KeyError,TypeError,OSError):
            return False

    def submit(self,tenant,command,request_id,body_hash,today: date,conversation_id=None,message_id=None):
        if conversation_id is not None or message_id is not None:
            from dialogue import submit as dialogue_submit
            return dialogue_submit(self,tenant,command,request_id,body_hash,today,conversation_id,message_id)
        return self._submit(tenant,command,request_id,body_hash,today)

    def _submit(self,tenant,command,request_id,body_hash,today: date,clarification=None):
        scope = self.scope_for(tenant)
        if scope.tenant != tenant: raise Rejected('TENANT_DENIED')
        from information import is_help
        if is_help(command):return self.control_once(tenant,'помощь',request_id,body_hash)
        if self.dataset_capabilities is not None:
            from dataset_pipeline import parse_request,make_dataset_plan
            draft=parse_request(command,today)
            if draft is not None:
                if draft.get('snapshot'):draft['snapshot_slot']=int(self.repo.clock()//300)
                plan=make_dataset_plan(scope,draft,self.dataset_capabilities())
                if not self.authorized(plan):raise Rejected('SOURCE_ACCESS')
                row,outcome=self.repo.enqueue(tenant,request_id,body_hash,draft,plan,fingerprint(asdict(scope)))
                text=self.describe(tenant,row,deliver=True)
                return {'text':text,'tts':text,'job_id':row['id'],'state':row['state'],'cache':outcome}
        if self.table_capabilities is not None:
            from table_analytics import parse_table
            tab=parse_table(command,today)
            if tab is not None:return self._submit_table(scope,tab,request_id,body_hash,clarification)
        draft = parse(command,today)
        if draft['route']=='P0':
            return self.control_once(tenant,draft['command'],request_id,body_hash)
        if clarification is not None:draft['clarification']=clarification
        draft['request_basis_policy']=POLICY_VERSION
        draft['catalog_pin']=self.catalog
        draft['compiler_pin']={'language':LANGUAGE,'projection':PROJECTION,'registry_hash':REGISTRY_HASH}
        if draft.get('snapshot'):draft['snapshot_slot']=int(self.repo.clock()//300)
        selected = scope.select(draft['platforms'])
        frozen = Scope(scope.tenant,scope.revision,selected)
        pre = make_composed_plan(frozen,draft,metrics=draft['metrics']) if draft['metrics'] else make_plan(frozen,draft,['stock_fbo_units'] if draft.get('snapshot') else ['ordered_units'])
        if not self.authorized(pre): raise Rejected('SOURCE_ACCESS')
        draft['scope_snapshot'] = asdict(frozen)
        plan = pre if draft['metrics'] else None
        if plan is not None:validate_request_basis(draft, plan)
        row,outcome = self.repo.enqueue(tenant,request_id,body_hash,draft,plan,fingerprint(asdict(frozen)))
        answer = self.describe(tenant,row,deliver=True)
        # Only a reminder, never combining old figures into this answer.
        unread = self.repo.unread(tenant,exclude=row['id'])
        if unread and self.authorized(strict_json(unread['plan'])) and len(answer)<740:
            answer += ' Также есть другой готовый непрочитанный отчет.'
        return {'text':answer,'tts':answer,'job_id':row['id'],'state':row['state'],'cache':outcome}

    def _submit_table(self,scope,draft,request_id,body_hash,clarification):
        from table_analytics import make_table_plan
        if clarification is not None:draft['clarification']=clarification
        plan=make_table_plan(scope,draft,self.table_capabilities())
        if not self.authorized(plan):raise Rejected('SOURCE_ACCESS')
        row,outcome=self.repo.enqueue(scope.tenant,request_id,body_hash,draft,plan,fingerprint(asdict(scope)))
        text=self.describe(scope.tenant,row,deliver=True)
        return {'text':text,'tts':text,'job_id':row['id'],'state':row['state'],'cache':outcome}

    def describe(self,tenant,row,deliver=False,next_page=False):
        if not row: return HELP
        if row['tenant'] != tenant: raise Rejected('TENANT_DENIED')
        if row['plan'] and not self.authorized(strict_json(row['plan'])):
            return 'Доступ к источнику изменился. Сохраненные цифры не выдаю.'
        state = row['state']
        if state=='READY':
            if (row['expires'] or 0)<=self.repo.clock():
                return 'Отчет устарел. Повторите исходный запрос для нового полного отчета.'
            if not deliver: return 'Отчет готов. Скажите: результат.'
            return self.repo.page(tenant,row['id'],next_page)
        if state in ('QUEUED','RUNNING'):
            wait = max(0,int(row['due']-self.repo.clock()))
            return ('Задание принято. '+(f'Ожидает интервала API, не ранее чем через {wait} секунд. ' if wait>1 else 'Выполняется. ')
                    +'Скажите: результат. Повтор этой команды не запускает новый расчет.')
        if state=='EXPIRED':
            return 'Срок хранения отчёта истёк. Данные удалены; новый вопрос создаст новый расчёт.'
        if state=='UNKNOWN':
            return 'Исход обращения неизвестен. Повторять его автоматически не буду. Нужна проверка задания.'
        if state=='CANCELLED': return 'Задание отменено. Уже отправленный запрос на стороне площадки отменить нельзя.'
        if state=='FAILED' and row['error'] in ('FINANCIAL_BASIS_NOT_REQUESTED','SALES_SOURCE_MISMATCH_WITHDRAWN'):
            return 'Прежний финансовый отчёт не отвечает исходному вопросу и снят с выдачи. '+CLARIFICATION
        if state=='FAILED':
            from failure_explanations import explain
            return explain(row['error'])['text']
        return 'Отчет пока недоступен.'

    def control_once(self,tenant,command,request_id,body_hash):
        def action():
            # Capture the report used by this request, not a later pointer.
            public = command in ('помощь','помощь аналитики','что ты умеешь','диагностика аналитики','отмени отчет')
            row = None if public else self.repo.get(tenant)
            reply = self.control(tenant,command)
            plan = strict_json(row['plan']) if row and row['plan'] else None
            if plan and not self.authorized(plan):
                # A denial is not a cached financial response.
                plan = None
            expires = row['expires'] if plan and row['state']=='READY' else None
            return reply,plan,expires
        return self.repo.control_reply(tenant,request_id,body_hash,action,self.authorized)

    def control(self,tenant,command):
        if command in ('помощь','помощь аналитики','что ты умеешь'):
            from information import help_text
            text=help_text(self,tenant)
        elif command=='диагностика аналитики':
            text='Матрица 0.9, сборка 8. Уточнения сохраняют запрос и период в текущей беседе. Общее ядро вложенных формул; речевые шаблоны — отдельный каталог. Заказы, реклама, ДРР от заказов, воронка WB, финансовые отчёты и текущие остатки. Реальные API, точный кэш. Чистая прибыль требует отсутствующей себестоимости; исторические остатки не подменяю текущими.'
            if self.table_capabilities is not None:text='Матрица 0.10, базовый пакет 1. Фактические продажи WB по дате события, рейтинги товаров и дневная динамика. Товарные начисления Ozon доступны отдельно по дате начисления; это не фактические выкупы. Уточнения, точный кэш и очистка сохранены.'
            if self.dataset_capabilities is not None:
                from dataset_pipeline import CATALOG
                text+=' Дополнительный пакет наборов данных: '+CATALOG['version']+'. Доступны только источники с подтверждённым допуском.'
        elif command=='отмени отчет':
            from reader_state import key as reader_key
            local=bool(reader_key(self.repo,tenant))
            text=('Задание отменено для этой беседы. Другие беседы продолжают свою работу.' if local else 'Задание отменено.') if self.repo.cancel(tenant) else 'Активного задания для отмены нет.'
        else:
            row=self.repo.get(tenant)
            if command=='план запроса':
                if row and row['plan'] and self.authorized(strict_json(row['plan'])):
                    p=strict_json(row['plan'])
                    if 'dataset' in p:
                        text='План набора данных '+p['dataset']['id']+'. Полная выборка и обработка общей матрицей; без повторного расчёта при чтении.'
                    elif 'table' in p:
                        t=p['table'];text=f"Период {p['period']['from']} — {p['period']['to']}. Табличный план: {t['family']}; разрез {t['view']}; топ {t['top'] or 'все строки'}. Фильтр → группировка → сортировка после полной выборки."
                    else:text=f"Период с {p['period']['from']} по {p['period']['to']}. Магазинов: {len(p['stores'])}. "+(explain_program(p['program']) if 'program' in p else ', '.join(p['metrics']))+'. Полный период без дневного дробления.'
                else: text='Доступного сформированного плана нет.'
            else: text=self.describe(tenant,row,deliver=command!='статус отчета',next_page=command=='дальше')
        return {'text':text,'tts':text}

    def safe_submit(self,*args,**kwargs):
        try: return self.submit(*args,**kwargs)
        except Rejected as exc:
            from failure_explanations import rejection_reply
            return rejection_reply(exc.code,exc.message,exc.context)

class Worker:
    """One HTTP request per step, except a P2 step which only invokes the model.
    No scheduled retries for uncertain outcomes. Queue throttling is not a retry.
    """
    def __init__(self,engine: Engine,transport):
        self.engine,self.repo,self.transport=engine,engine.repo,transport

    def _call(self,row,request,store=None):
        event=self.repo.reserve(row['id'],row['owner'],request.source,request.interval,request.daily_limit)
        try:
            value,meta=self.transport.execute(request,store)
            self.repo.received(event,meta)
            return value
        except CallError as exc:
            self.repo.failed_call(event,exc.status,exc.unknown)
            if exc.retry_at:
                self.repo.defer_source(request.source,max(exc.retry_at,self.repo.clock()+request.interval))
            if store and exc.status in (401,403):
                self.repo.deny(request.source,store['access_revision'])
            raise
        except Exception:
            self.repo.failed_call(event,unknown=True)
            raise CallError('UNEXPECTED_TRANSPORT_OUTCOME',unknown=True) from None

    def step(self):
        row=self.repo.claim()
        if not row: return False
        jid,owner=row['id'],row['owner']
        try:
            draft=strict_json(row['draft'])
            if not row['plan']:
                if draft.get('compiler_pin')!={'language':LANGUAGE,'projection':PROJECTION,'registry_hash':REGISTRY_HASH}:raise Rejected('PENDING_PLAN_VERSION_CHANGED')
                snapshot=draft['scope_snapshot']
                frozen=Scope(snapshot['tenant'],snapshot['revision'],tuple(Store(**s) for s in snapshot['stores']))
                pre=make_plan(frozen,draft,['stock_fbo_units'] if draft.get('snapshot') else ['ordered_units'])
                if not self.engine.authorized(pre): raise Rejected('SOURCE_ACCESS')
                request=providers.Request('deepseek_parse','model:deepseek-flash','',{'question':draft['question'],'catalog':draft.get('catalog_pin',self.engine.catalog),'slots':{k:draft.get(k) for k in ('period','comparison','filters','platforms','group_by','snapshot')}},self.engine.model_budget['min_interval_seconds'],self.engine.model_budget['daily_calls'])
                response=self._call(row,request)
                expressions=validate_model_program(response['content'],response['finish_reason'],draft)
                plan=make_composed_plan(frozen,draft,expressions=expressions)
                validate_request_basis(draft,plan)
                if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
                resolved=self.repo.resolve(jid,owner,plan)
                if resolved['id']==jid:
                    self.repo.reschedule(jid,owner)
                return True
            plan=strict_json(row['plan'])
            validate_request_basis(draft,plan)
            if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
            if 'dataset' in plan:
                from dataset_pipeline import worker_step
                worker_step(self,row,plan)
                return True
            if 'table' in plan:
                from table_analytics import worker_step
                worker_step(self,row,plan)
                return True
            progress=strict_json(row['progress']) if row['progress'] else {'completed':[],'page':None,'task_index':0,'partial':None}
            done=progress['completed'];index=len(done)
            if index>=len(plan['stores']): raise Rejected('PROGRESS_SCHEMA')
            store=plan['stores'][index];tasks=providers.tasks(plan,store)
            task_index=progress.get('task_index',0)
            if not 0<=task_index<len(tasks):raise Rejected('PROGRESS_TASK')
            task=tasks[task_index]
            request=providers.build_task(plan,store,task,progress['page'])
            prerequisite=self.transport.prepare(request,store) if hasattr(self.transport,'prepare') else None
            if prerequisite:
                self._call(row,prerequisite,store)
                self.repo.reschedule(jid,owner,progress)
                return True
            response=self._call(row,request,store)
            result=providers.decode_task(response,plan,store,task,progress['page'])
            if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
            if result['complete']:
                partial=progress.get('partial') or {'store_id':store['id'],'values':{},'previous_values':{},'currency':None,'rows':0,'complete':False}
                if result['currency'] is not None:
                    if partial['currency'] not in (None,result['currency']):raise Rejected('SOURCE_CURRENCY_MISMATCH')
                    partial['currency']=result['currency']
                partial['rows']+=result['rows']
                bucket='values' if task['role']=='current' else 'previous_values'
                for metric,value in result['values'].items():
                    partial[bucket][metric]=providers.amount(providers.metric_number(metric,partial[bucket].get(metric,'0'))+providers.metric_number(metric,value))
                for metric,value in result.get('previous_values',{}).items():
                    partial['previous_values'][metric]=providers.amount(providers.metric_number(metric,partial['previous_values'].get(metric,'0'))+providers.metric_number(metric,value))
                progress.update(partial=partial,page=None,task_index=task_index+1)
                if progress['task_index']==len(tasks):
                    partial['complete']=True
                    if not plan.get('comparison'):partial.pop('previous_values',None)
                    done.append(partial);progress.update(partial=None,page=None,task_index=0)
            else:progress['page']=result['progress']
            if len(done)==len(plan['stores']):
                stamp=datetime.fromtimestamp(self.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
                report=providers.render(plan,done,stamp)
                self.repo.complete(jid,owner,report)
            else:self.repo.reschedule(jid,owner,progress)
        except Deferred as exc:
            self.repo.reschedule(jid,owner,until=exc.until)
        except CallError as exc:
            if exc.status == 429 and not exc.unknown:
                # HTTP 429 is a known rejection, unlike a transport timeout.
                # Bound all automatic retries and preserve the exact job identity.
                with self.repo.connection() as c:
                    failures = c.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND http=429', (jid,)).fetchone()[0]
                if failures <= 2:
                    pause = 90 * (2 ** (failures - 1))
                    due = max(exc.retry_at or 0, self.repo.clock() + pause)
                    self.repo.reschedule(jid, owner, until=due)
                else:
                    self.repo.fail(jid, owner, 'HTTP_429_RETRY_EXHAUSTED')
            else:
                self.repo.fail(jid,owner,exc.code,exc.unknown)
        except (Rejected,MatrixError) as exc:
            # A known response failed deterministic schema/math/projection checks.
            # Do not misclassify it as an uncertain provider outcome.
            self.repo.fail(jid,owner,exc.code)
        except Exception:
            self.repo.fail(jid,owner,'WORKER_INTERNAL_UNKNOWN',unknown=True)
        return True
