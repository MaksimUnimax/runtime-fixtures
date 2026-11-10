"""Network-free ingress facade and one-step worker with injectable transport."""
from __future__ import annotations
from model_recovery import DecisionRepaired
import re
import copy
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
    def __init__(self,code,status=None,unknown=False,retry_at=None,feedback=None,model_usage=None):
        self.code,self.status,self.unknown,self.retry_at = code,status,unknown,retry_at
        self.feedback=feedback
        self.model_usage=model_usage
        super().__init__(code)

def validate_model_budget(value):
    # The owner removed app-imposed call budgets. Numeric daily caps are not
    # silently accepted or replaced by another arbitrary higher allowance.
    if (not isinstance(value,dict) or set(value)!={'schema','daily_calls','min_interval_seconds'}
        or value['schema']!='alice-model-budget/v2' or value['daily_calls'] is not None
        or type(value['min_interval_seconds']) is not int
        or value['min_interval_seconds']!=0):raise Rejected('MODEL_BUDGET_SCHEMA')
    return dict(value)

class Engine:
    def __init__(self,repository: Repository,scope_for: Callable[[str], Scope],catalog=None,table_capabilities=None,dataset_capabilities=None,read_surface=None,answer_settings=None,execution_policy=None,template_mode=False,report_archive=None):
        self.repo,self.scope_for = repository,scope_for
        self.execution_policy=execution_policy
        self.template_mode=bool(template_mode)
        self.report_archive=report_archive
        self.repo.execution_authorizer=self.authorize_job
        self.read_surface=read_surface
        self.answer_settings=answer_settings
        self.repo.answer_settings=answer_settings
        self.table_capabilities=table_capabilities
        self.dataset_capabilities=dataset_capabilities
        self.catalog=validate_catalog_typed(catalog or EXPRESSION_CATALOG)
        self.model_budget=validate_model_budget(strict_json(Path(__file__).with_name('resource_limits.json').read_text()))
        from dialogue import ensure_schema
        ensure_schema(self.repo)
        from retention import install
        install(self.repo)

    def authorized(self,plan):
        if plan.get('schema')=='alice-template-execution/v1':
            from template_runtime import authorized
            return authorized(self,plan)
        try:
            scope = self.execution_scope(plan.get('runtime_guard'),plan['tenant'])
            if 'universal_read'in plan:
                if self.read_surface is None or not self.read_surface.authorized(plan,scope):return False
                refs=plan.get('read_source_refs',[])
                if type(refs)is not list:return False
                stores={s['id']:s for s in plan['stores']}
                for ref in refs:
                    if type(ref)is not dict or set(ref)!={'store_id','source','revision'}:return False
                    store=stores.get(ref['store_id'])
                    if store is None or ref['revision']!=store['access_revision']or not ref['source'].startswith(store['platform']+':'+store['identity']+':'):return False
                    if self.repo.denied(ref['source'],ref['revision']):return False
                return True
            if not plan_authorized(plan,scope): return False
            if 'program' in plan and not validate_compiled(plan):return False
            if 'dataset' in plan:
                from dataset_pipeline import valid
                dataset_plan={k:v for k,v in plan.items() if k!='runtime_guard'}
                if not valid(dataset_plan) or self.dataset_capabilities is None:return False
                caps=self.dataset_capabilities()
                if any(caps.get(sid,{}).get(op)!=proof for sid,ops in plan['dataset_capabilities'].items() for op,proof in ops.items()):return False
            if 'table' in plan:
                from table_analytics import valid
                if not valid(plan) or self.table_capabilities is None:return False
                caps=self.table_capabilities()
                if any(caps.get(sid,{}).get(op)!=proof for sid,operations in plan['table_capabilities'].items() for op,proof in operations.items()):return False
            return not any(self.repo.denied(source,s['access_revision']) for s in plan['stores'] for source in providers.sources(plan,s))
        except Rejected as error:
            if plan.get('runtime_guard') is not None and error.code=='DEPENDENCY_UNAVAILABLE':raise
            return False
        except (KeyError,TypeError,OSError):
            return False

    def execution_scope(self,guard,tenant):
        if guard is None:return self.scope_for(tenant)
        if self.execution_policy is None:raise Rejected('AUTH_REQUIRED')
        scope=self.execution_policy.scope_for(guard)
        if scope.tenant!=tenant:raise Rejected('TENANT_DENIED')
        return scope

    @staticmethod
    def pin_execution(value,guard):
        if value is not None and guard is not None:value['runtime_guard']=copy.deepcopy(guard)
        return value

    def authorize_job(self,row):
        draft=strict_json(row['draft'])
        guard=draft.get('runtime_guard')
        plan=strict_json(row['plan']) if row['plan'] else None
        if plan is not None and plan.get('runtime_guard')!=guard:raise Rejected('PERMISSION_DENIED')
        if guard is not None:
            self.execution_scope(guard,row['tenant'])
            if plan is not None and not self.output_authorized(row):raise Rejected('PERMISSION_DENIED')

    def scope_current(self,frozen,guard=None):
        """Before compilation only the accepted identity/scope is knowable."""
        try:
            current=self.execution_scope(guard,frozen.tenant)
            stores={store.id:asdict(store)for store in current.stores}
            return (current.tenant==frozen.tenant and current.revision==frozen.revision and bool(frozen.stores)
                and all(stores.get(store.id)==asdict(store)for store in frozen.stores))
        except Rejected as error:
            if guard is not None and error.code=='DEPENDENCY_UNAVAILABLE':raise
            return False
        except (KeyError,TypeError,OSError):return False

    def submit(self,tenant,command,request_id,body_hash,today: date,conversation_id=None,message_id=None):
        from model_answer import ORIGINAL_QUESTION
        token=ORIGINAL_QUESTION.set(command)
        try:
            if conversation_id is not None or message_id is not None:
                from dialogue import submit as dialogue_submit
                return dialogue_submit(self,tenant,command,request_id,body_hash,today,conversation_id,message_id)
            return self._submit(tenant,command,request_id,body_hash,today)
        finally:
            ORIGINAL_QUESTION.reset(token)

    def submit_method(self,tenant,store_id,operation,params,request_id,today,conversation):
        if self.template_mode:raise Rejected('TEMPLATE_DIRECT_METHOD_DISABLED','Временный режим: получение данных только через зарегистрированные шаблоны.')
        if self.read_surface is None:raise Rejected('READ_SURFACE_DISABLED')
        if not isinstance(conversation,str)or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}',conversation):raise Rejected('DIALOGUE_SCHEMA')
        scope=self.scope_for(tenant)
        if scope.tenant!=tenant:raise Rejected('TENANT_DENIED')
        with self.repo.reader_scope(tenant,conversation):
            return self.read_surface.submit_method(self,scope,store_id,operation,params,request_id,today)

    def _submit(self,tenant,command,request_id,body_hash,today: date,clarification=None,execution_context=None):
        if self.template_mode:
            from template_runtime import submit
            return submit(self,tenant,command,request_id,body_hash,today,clarification,execution_context)
        try:return self._submit_standard(tenant,command,request_id,body_hash,today,clarification,execution_context)
        except Rejected as error:
            if error.context and error.context.get('fallback_allowed')is False:raise
            codes={'PROMOTION_PARTICIPATION_NOT_ENABLED','OPERATION_NOT_ENABLED','PLATFORM_METRIC_NOT_ENABLED','PERIOD_REQUIRED','STORE_ALIAS'}
            if self.read_surface is None or error.code not in codes:raise
            if error.code=='PERIOD_REQUIRED':
                from semantics import PHRASES,BUNDLES
                normalized=command.lower().replace('ё','е')
                if any(phrase in normalized for phrases in PHRASES.values()for phrase in phrases)or any(phrase in normalized for phrase in BUNDLES):raise
            scope=self.execution_scope(execution_context,tenant)
            if scope.tenant!=tenant:raise Rejected('TENANT_DENIED')
            return self.read_surface.submit(self,scope,command,request_id,body_hash,today,execution_context=execution_context)

    def _submit_standard(self,tenant,command,request_id,body_hash,today: date,clarification=None,execution_context=None):
        scope = self.execution_scope(execution_context,tenant)
        if scope.tenant != tenant: raise Rejected('TENANT_DENIED')
        from information import is_help,unavailable_topic
        if is_help(command):
            if execution_context is not None:raise Rejected('VALIDATION_FAILED')
            return self.control_once(tenant,'помощь',request_id,body_hash)
        if unavailable_topic(command):
            # Keep sensitive/read-only guards, then reject the unavailable subject
            # before dataset/table parsers can request an irrelevant period.
            parse(command,today)
        if self.dataset_capabilities is not None:
            from dataset_pipeline import parse_request,make_dataset_plan
            draft=parse_request(command,today)
            if draft is not None:
                if draft.get('snapshot'):draft['snapshot_slot']=int(self.repo.clock()//300)
                self.pin_execution(draft,execution_context)
                plan=self.pin_execution(make_dataset_plan(scope,draft,self.dataset_capabilities()),execution_context)
                if not self.authorized(plan):raise Rejected('SOURCE_ACCESS')
                row,outcome=self.repo.enqueue(tenant,request_id,body_hash,draft,plan,fingerprint(asdict(scope)),update_pointer=execution_context is None)
                if execution_context is not None:return {'job_id':row['id'],'state':row['state'],'cache':outcome}
                text=self.describe(tenant,row,deliver=True)
                return {'text':text,'tts':text,'job_id':row['id'],'state':row['state'],'cache':outcome}
        if self.table_capabilities is not None:
            from table_analytics import parse_table
            tab=parse_table(command,today)
            if tab is not None:return self._submit_table(scope,tab,request_id,body_hash,clarification,execution_context)
        draft = parse(command,today)
        if draft['route']=='P0':
            if execution_context is not None:raise Rejected('VALIDATION_FAILED')
            return self.control_once(tenant,draft['command'],request_id,body_hash)
        if clarification is not None:draft['clarification']=clarification
        self.pin_execution(draft,execution_context)
        draft['request_basis_policy']=POLICY_VERSION
        draft['catalog_pin']=self.catalog
        draft['compiler_pin']={'language':LANGUAGE,'projection':PROJECTION,'registry_hash':REGISTRY_HASH}
        if draft.get('snapshot'):draft['snapshot_slot']=int(self.repo.clock()//300)
        selected = scope.select(draft['platforms'])
        if re.search(r'\bрубл\w*\b',command,re.I)and any(store.currency!='RUB'for store in selected):
            raise Rejected('CURRENCY_UNCONFIRMED')
        frozen = Scope(scope.tenant,scope.revision,selected)
        pre = make_composed_plan(frozen,draft,metrics=draft['metrics']) if draft['metrics'] else None
        self.pin_execution(pre,execution_context)
        if not (self.authorized(pre)if pre is not None else self.scope_current(frozen,execution_context)):raise Rejected('SOURCE_ACCESS')
        draft['scope_snapshot'] = asdict(frozen)
        plan = pre if draft['metrics'] else None
        if plan is not None:validate_request_basis(draft, plan)
        row,outcome = self.repo.enqueue(tenant,request_id,body_hash,draft,plan,fingerprint(asdict(frozen)),update_pointer=execution_context is None)
        if execution_context is not None:return {'job_id':row['id'],'state':row['state'],'cache':outcome}
        answer = self.describe(tenant,row,deliver=True)
        # Only a reminder, never combining old figures into this answer.
        unread = self.repo.unread(tenant,exclude=row['id'])
        if unread and self.authorized(strict_json(unread['plan'])) and len(answer)<740:
            answer += ' Также есть другой готовый непрочитанный отчет.'
        return {'text':answer,'tts':answer,'job_id':row['id'],'state':row['state'],'cache':outcome}

    def _submit_table(self,scope,draft,request_id,body_hash,clarification,execution_context=None):
        from table_analytics import make_table_plan
        if clarification is not None:draft['clarification']=clarification
        self.pin_execution(draft,execution_context)
        plan=self.pin_execution(make_table_plan(scope,draft,self.table_capabilities()),execution_context)
        if not self.authorized(plan):raise Rejected('SOURCE_ACCESS')
        row,outcome=self.repo.enqueue(scope.tenant,request_id,body_hash,draft,plan,fingerprint(asdict(scope)),update_pointer=execution_context is None)
        if execution_context is not None:return {'job_id':row['id'],'state':row['state'],'cache':outcome}
        text=self.describe(scope.tenant,row,deliver=True)
        return {'text':text,'tts':text,'job_id':row['id'],'state':row['state'],'cache':outcome}

    def access_failure_notice(self,row):
        """Allow only fixed failure text to the still-authorized store owner.

        A provider403 itself denies its source. It must not hide the reason for
        that FAILED job. No result, artifact, source data or execution permission
        is granted here; READY and actual data keep the full source-denial check.
        """
        try:
            from failure_explanations import CATALOG,explain
            code=row['error']
            allowed=code in CATALOG['entries']and (code in ('HTTP_401','HTTP_403')or code.startswith('HTTP_403_OZON_')or code=='HTTP_403_READ_RESOURCE_DENIED')
            if row['state']!='FAILED'or not allowed or not row['plan']:return None
            from retention import PAYLOAD_TTL
            if row['updated']+PAYLOAD_TTL<=self.repo.clock():return None
            plan=strict_json(row['plan'])
            if plan['tenant']!=row['tenant']:return None
            frozen=Scope(plan['tenant'],plan['access_revision'],tuple(Store(**store)for store in plan['stores']))
            if not self.scope_current(frozen,plan.get('runtime_guard')):return None
            from provider_access_result import stored
            value=stored(row)
            return value['message']if value is not None else explain(code)['text']
        except (Rejected,KeyError,TypeError,ValueError,OSError):return None

    def access_failure_result(self,row):
        if row['plan']and strict_json(row['plan']).get('schema')=='alice-template-execution/v1':
            from template_runtime import gap_result
            value=gap_result(self,row)
            if value is not None:return value
        from provider_access_result import stored
        if row['state']=='FAILED':
            if self.access_failure_notice(row)is None:return None
        elif row['state']=='READY':
            from provider_failure import notice_authorized
            if not notice_authorized(self,row)or(row['expires']or 0)<=self.repo.clock():return None
        else:return None
        return stored(row)

    def output_authorized(self,row):
        from provider_failure import permission_notice, notice_authorized
        if permission_notice(row) is not None:return notice_authorized(self,row)
        return not row['plan'] or self.authorized(strict_json(row['plan']))

    def delivery_plan(self,row):
        from provider_failure import permission_notice
        notice=permission_notice(row)
        if notice is not None:
            return {'schema':'alice-error-delivery/v1','tenant':row['tenant'],'job_id':row['id'],'receipt':notice['failure_receipt']}
        return strict_json(row['plan']) if row['plan'] else None

    def delivery_authorized(self,plan):
        if plan.get('schema')=='alice-error-delivery/v1':
            if set(plan)!={'schema','tenant','job_id','receipt'}:return False
            row=self.repo.get(plan['tenant'],plan['job_id'])
            if not row or row['id']!=plan['job_id']:return False
            from provider_failure import permission_notice,notice_authorized
            notice=permission_notice(row)
            return notice is not None and notice['failure_receipt']==plan['receipt'] and notice_authorized(self,row)
        return self.authorized(plan)

    def describe(self,tenant,row,deliver=False,next_page=False):
        if not row: return HELP
        if row['tenant'] != tenant: raise Rejected('TENANT_DENIED')
        failure_notice=self.access_failure_notice(row)
        if failure_notice is not None:return failure_notice
        if not self.output_authorized(row):
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
            plan = self.delivery_plan(row) if row else None
            if plan and not self.delivery_authorized(plan):
                # Rights may have changed after control() produced the text.
                # Never cache or return that text as an unprotected reply.
                raise Rejected('SOURCE_ACCESS')
            expires = row['expires'] if plan and row['state']=='READY' else None
            return reply,plan,expires
        return self.repo.control_reply(tenant,request_id,body_hash,action,self.delivery_authorized)

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
                    if 'universal_read'in p:
                        text='Универсальный read-план по каталогу методов Ozon/WB. Шаблон отчёта не требуется; вызовы выполняются в общей очереди.'
                    elif 'dataset' in p:
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
    Transient read failures resume the same durable job through one shared policy.
    """
    def __init__(self,engine: Engine,transport):
        self.engine,self.repo,self.transport=engine,engine.repo,transport

    def _call(self,row,request,store=None,*,on_rejection=None,on_received=None):
        def authorize_dispatch():
            if strict_json(row['draft']).get('runtime_guard') is None:
                self.engine.authorize_job(row)
                return
            current=self.repo.get(row['tenant'],row['id'])
            if (current is None or current['id']!=row['id'] or current['state']!='RUNNING'
                or current['owner']!=row['owner']):raise Rejected('PERMISSION_DENIED')
            self.engine.authorize_job(current)
            # Authority RPC can block while another reader cancels the last
            # subscription or the lease changes. Do not send using its stale
            # pre-RPC queue snapshot, and do not count a prevented model call.
            latest=self.repo.get(row['tenant'],row['id'])
            if (latest is None or latest['id']!=row['id'] or latest['state']!='RUNNING'
                or latest['owner']!=row['owner']):raise Rejected('PERMISSION_DENIED')
        authorize_dispatch()
        # Keep the single ledger, provider pacing and Retry-After, but no local
        # daily allowance for either model or marketplace calls.
        from request_recovery import repeat_safe, retry_due
        safe = repeat_safe(request)
        self.repo.mark_resume_safe(row['id'], row['owner'], safe)
        event=self.repo.reserve(row['id'],row['owner'],request.source,request.interval,None)
        try:
            observed=getattr(self.transport,'execute_observed',None)
            guarded=strict_json(row['draft']).get('runtime_guard') is not None
            if observed is not None and (guarded or request.source.startswith('model:')):
                def dispatched():
                    authorize_dispatch()
                    if request.source.startswith('model:'):
                        import model_usage
                        model_usage.dispatched(self.repo,event)
                        return lambda:model_usage.undispatched(self.repo,event)
                from report_archive import observe
                value,meta=observe(self.engine,row,event,request,store,lambda:observed(request,store,dispatched))
            else:
                from report_archive import observe
                value,meta=observe(self.engine,row,event,request,store,lambda:self.transport.execute(request,store))
        except Rejected as exc:
            from report_archive import ReceivedArchiveError
            if isinstance(exc,ReceivedArchiveError):self.repo.received(event,exc.receipt)
            else:self.repo.failed_call(event,unknown=False,code=exc.code)
            raise
        except CallError as exc:
            if request.source.startswith('model:'):
                import model_usage
                model_usage.record(self.repo,event,exc.model_usage)
            repaired=False
            with self.repo.connection(True):
                self.repo.failed_call(event,exc.status,exc.unknown,exc.code)
                due = retry_due(self.repo, row, request, exc, safe)
                if due is None:
                    if store and exc.status in (401,403):self.repo.deny(request.source,store['access_revision'])
                    from provider_failure import stage
                    repaired=stage(self,row,request,exc,event)
                    if not repaired and on_rejection is not None:repaired=on_rejection(exc)
            if repaired:
                from model_recovery import DecisionRepaired
                raise DecisionRepaired() from None
            if due is not None:
                self.repo.defer_source(request.source, due)
                print(canonical_json({'event':'request_recovering','job_hash':fingerprint(row['id'])[:16],'operation':request.operation,'code':exc.code,'retry_at':due}),flush=True)
                raise Deferred(due) from None
            raise
        except Exception:
            self.repo.failed_call(event,unknown=True,code='UNEXPECTED_TRANSPORT_OUTCOME')
            raise CallError('UNEXPECTED_TRANSPORT_OUTCOME',unknown=True) from None
        if request.source.startswith('model:'):
            import model_usage
            model_usage.record(self.repo,event,meta.get('model_usage'))
        # Local persistence errors are not an uncertain network outcome.
        with self.repo.connection(True):
            self.repo.received(event,meta)
            from report_archive import capture
            capture(self.engine,row,event,request,store,value,meta)
            if store is not None and not request.operation.startswith('read.') and not meta.get('authentication_only'):
                self.repo.capture_api_answer(row,event,request,value)
            if on_received is not None:on_received(value)
        return value

    def step(self):
        row=self.repo.claim()
        if not row: return False
        jid,owner=row['id'],row['owner']
        try:
            self.engine.authorize_job(row)
            draft=strict_json(row['draft'])
            from model_answer import PENDING, step as answer_step
            saved=strict_json(row['progress']) if row['progress'] else {}
            if PENDING in saved:
                answer_step(self,row,strict_json(row['plan']),saved)
                return True
            if row['plan']and strict_json(row['plan']).get('schema')=='alice-template-execution/v1':
                from template_runtime import worker_step
                worker_step(self,row,strict_json(row['plan']));return True
            if self.engine.template_mode and row['plan']and 'universal_read'in strict_json(row['plan']):
                raise Rejected('TEMPLATE_UNIVERSAL_DISABLED')
            if not row['plan']:
                if draft.get('compiler_pin')!={'language':LANGUAGE,'projection':PROJECTION,'registry_hash':REGISTRY_HASH}:raise Rejected('PENDING_PLAN_VERSION_CHANGED')
                snapshot=draft['scope_snapshot']
                frozen=Scope(snapshot['tenant'],snapshot['revision'],tuple(Store(**s) for s in snapshot['stores']))
                if not self.engine.scope_current(frozen,draft.get('runtime_guard')):raise Rejected('SOURCE_ACCESS')
                request=providers.Request('deepseek_parse','model:deepseek-flash','',{'question':draft['question'],'catalog':draft.get('catalog_pin',self.engine.catalog),'slots':{k:draft.get(k) for k in ('period','comparison','filters','platforms','group_by','snapshot')}},self.engine.model_budget['min_interval_seconds'],self.engine.model_budget['daily_calls'])
                from request_recovery import compiler_decision
                progress=strict_json(row['progress']) if row['progress'] else {}
                if progress.get('compiler_feedback'):request.body['repair']=progress['compiler_feedback']
                from model_answer import planning_prompt
                prompt=planning_prompt(self,row)
                if prompt is not None:request.body['instruction']=prompt
                response=self._call(row,request)
                from model_recovery import compiler_declines
                if self.engine.read_surface is not None and compiler_declines(response):
                    # The typed metric vocabulary declined the WHOLE question.
                    # Discover methods in the same job, before any business IO.
                    universal=self.engine.read_surface.plan(frozen,draft['question'],date.fromisoformat(draft['calendar_date']),row['created'])
                    self.engine.pin_execution(universal,draft.get('runtime_guard'))
                    universal['request_contract']={key:draft.get(key)for key in ('period','comparison','filters','platforms','group_by','snapshot','calendar_date','timezone')}
                    if not self.engine.authorized(universal):raise Rejected('SOURCE_ACCESS')
                    resolved=self.repo.resolve(jid,owner,universal)
                    if resolved['id']==jid:self.repo.reschedule(jid,owner)
                    return True
                expressions=compiler_decision(response,draft,progress)
                if expressions is None:
                    self.repo.reschedule(jid,owner,progress);return True
                plan=self.engine.pin_execution(make_composed_plan(frozen,draft,expressions=expressions),draft.get('runtime_guard'))
                validate_request_basis(draft,plan)
                if not self.engine.authorized(plan): raise Rejected('SOURCE_ACCESS')
                resolved=self.repo.resolve(jid,owner,plan)
                if resolved['id']==jid:
                    self.repo.reschedule(jid,owner)
                return True
            plan=strict_json(row['plan'])
            if 'universal_read'in plan:
                if not self.engine.authorized(plan):raise Rejected('SOURCE_ACCESS')
                from universal_reads import worker_step
                worker_step(self,row,plan)
                return True
            if not self.engine.template_mode:
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
                if draft.get('answer_by_model'):
                    self.repo.stage_answer(jid,owner,{'data':done,'fetched_at':stamp})
                else:self.repo.complete(jid,owner,providers.render(plan,done,stamp))
            else:self.repo.reschedule(jid,owner,progress)
        except DecisionRepaired:
            pass
        except Deferred as exc:
            self.repo.reschedule(jid,owner,until=exc.until)
        except CallError as exc:
            from provider_access_result import from_error
            self.repo.fail(jid,owner,exc.code,exc.unknown,model_response=from_error(exc))
        except (Rejected,MatrixError) as exc:
            # A known response failed deterministic schema/math/projection checks.
            # Do not misclassify it as an uncertain provider outcome.
            self.repo.fail(jid,owner,exc.code)
        except Exception:
            self.repo.fail(jid,owner,'WORKER_INTERNAL_UNKNOWN',unknown=True)
        return True

