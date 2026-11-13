"""Additive, context-checked clarification extension; frozen source is untouched."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_overlay_base', ROOT.parent / 'platform_stores/build_overlay.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

POLICY = '''
Если зарегистрированный шаблон может ответить на вопрос, но пользователь не указал обязательный период, смысл показателя, ось даты, фильтр или другое необходимое условие, НЕ выдумывай это условие и НЕ объявляй отсутствие шаблона. Задай один короткий вопрос без расчёта:
{"action":"clarify","question":"Короткий вопрос пользователю","missing":["period"]}
Имена missing — латинские идентификаторы, например period или date_axis. Сохрани все уже заданные условия. Ответы пользователя находятся в clarifications и дополняют исходный вопрос. Не переспрашивай явно указанное. Не требуй период для текущего snapshot или справки. Если подходящего шаблона нет даже при полном уточнении, используй unsupported. Не включай в уточнение секреты, цитату исходного вопроса или придуманные результаты API.
'''


def sources(root):
    result = {'template_clarification.py': (ROOT / 'template_clarification.py').read_text(),
              'tests/test_template_clarification_extension.py': (ROOT / 'checks.py').read_text()}
    text = (root / 'template_runtime.py').read_text()
    text = base.replace_once(text, '    # Validate the selected registered recipes locally. No extra model call.',
        "    if type(decision)is dict and decision.get('action')=='clarify' and type(plan.get('runtime_guard'))is dict:\n"
        "        from template_clarification import pause\n"
        "        return pause(worker,row,plan,progress,decision)\n"
        '    # Validate the selected registered recipes locally. No extra model call.')
    text = base.replace_once(text, 'from template_protocol import SELECT_SYSTEM,payload as model_payload',
        'from template_protocol import SELECT_SYSTEM,selection_system,payload as model_payload')
    text = base.replace_once(text, "            op='template_select';body={'system':SELECT_SYSTEM,",
        "            if type(plan.get('runtime_guard'))is dict:ctx['clarification_supported']=True\n"
        "            op='template_select';body={'system':selection_system(ctx),")
    result['template_runtime.py'] = text
    text = (root / 'template_protocol.py').read_text()
    text = base.replace_once(text, 'VERIFY_SYSTEM=', 'CLARIFY_SELECT_SYSTEM = SELECT_SYSTEM + ' + repr(POLICY) +
        "\ndef selection_system(context):\n"
        "    return CLARIFY_SELECT_SYSTEM if type(context)is dict and context.get('clarification_supported')is True else SELECT_SYSTEM\n"
        'VERIFY_SYSTEM=')
    text = base.replace_once(text, "'template_select':SELECT_SYSTEM,",
        "'template_select':selection_system(body.get('context')),")
    result['template_protocol.py'] = text
    text = (root / 'runtime_port.py').read_text()
    text = base.replace_once(text,
        "'operations':['submit','status','read_result','cancel','capabilities','current_versions','list_reports','read_report'],",
        "'operations':['submit','status','read_result','cancel','capabilities','current_versions','list_reports','read_report']+(['clarify']if self.engine.template_mode else[]),")
    text = base.replace_once(text, '    def _lookup(self,c,ref,ctx,guard):',
        "    def clarify(self,payload,peer):\n"
        "        from template_clarification import clarify\n"
        "        return clarify(self,payload,peer)\n\n"
        '    def _lookup(self,c,ref,ctx,guard):')
    text = base.replace_once(text, "        result={'job_ref':ref,'state':state,", "        from template_clarification import pending\n"
        "        if state=='READY' and pending(row):state='NEEDS_INPUT'\n"
        "        result={'job_ref':ref,'state':state,")
    text = base.replace_once(text, "            if status['state']!='READY':raise Rejected('RESULT_NOT_READY')",
        "            if status['state']not in('READY','NEEDS_INPUT'):raise Rejected('RESULT_NOT_READY')")
    text = base.replace_once(text, "            if access is not None:reply['model_result']=access\n            return reply",
        "            if access is not None:reply['model_result']=access\n"
        "            if status['state']=='NEEDS_INPUT':\n"
        "                reply['result_kind']='CLARIFICATION';reply['clarification']=result['clarification']\n"
        "            return reply")
    result['runtime_port.py'] = text
    text = base.replace_once(text, "            if row['state'] in ('QUEUED','RUNNING'):",
        "            from template_clarification import pending,cancel_pending\n"
        "            if pending(row):\n"
        "                changed=cancel_pending(self,c,ref,row)\n"
        "                _,row=self._lookup(c,ref_id,ctx,guard)\n"
        "            elif row['state'] in ('QUEUED','RUNNING'):")
    result['runtime_port.py'] = text
    text = (root / 'repository.py').read_text()
    text = base.replace_once(text, "            failure=result.get('failure_code')",
        "            if strict_json(row['draft']).get('question_clarifications') and not result.get('clarification'):\n"
        "                result=dict(result,clarification_resolved=True)\n"
        "            failure=result.get('failure_code')")
    result['repository.py'] = text
    result['query_gap_terminal.py'] = terminal_source(root)
    text = (root / 'runtime_port_ipc.py').read_text()
    result['runtime_port_ipc.py'] = base.replace_once(text, "    if op=='submit':return port.submit(payload,peer)",
        "    if op=='submit':return port.submit(payload,peer)\n"
        "    if op=='clarify':return port.clarify(payload,peer)")
    result.update(regression_sources(root))
    for name, text in result.items():
        if name.endswith('.py'):
            compile(text, name, 'exec')
    return result


def regression_sources(root):
    """Repair two fixture assumptions without changing any production behavior."""
    result = {}
    name = 'tests/test_retention.py'
    text = (root / name).read_text()
    result[name] = base.replace_once(text, '  before=self.path.stat().st_size\n',
        "  self.assertEqual(c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0],0);c.close()\n"
        '  before=self.path.stat().st_size\n')
    # This later installed-source suite is absent from the immutable R02 base.
    # The exact four published contracts are independent expected fixture data.
    name = 'tests/test_request_reliability.py'
    if (root / name).is_file():
        text = (root / name).read_text()
        result[name] = base.replace_once(text,
            "self.assertEqual(set(contracts),{'finance_storage_logistics','finance_storage_logistics_share'})",
            "self.assertEqual(set(contracts),{'finance_storage_logistics','finance_storage_logistics_share',"
            "'B06.finance_logistics_cost','B06.finance_storage_cost'})")
    return result


def terminal_source(root):
    text = (root / 'query_gap_terminal.py').read_text()
    replacements = [
        ("CLASSIFY=\"\"\"CASE\n", "CLASSIFY=\"\"\"CASE\n WHEN {clarification}IS NOT NULL THEN 'NEEDS_CLARIFICATION'\n"),
        (' ELSE NULL END""".format(model=', " WHEN {resolved}=1 AND new.state='READY'THEN 'NEEDS_CLARIFICATION'\n ELSE NULL END\"\"\".format(clarification=field('clarification'),resolved=field('clarification_resolved'),model="),
        ("    aliases=' JOIN jobs j0", "    for table in ('gap_terminal_seen','gap_terminal_outbox'):\n"
         "        if 'input_pending'not in {r[1]for r in c.execute('PRAGMA table_info('+table+')')}:\n"
         "            c.execute('ALTER TABLE '+table+' ADD COLUMN input_pending INTEGER NOT NULL DEFAULT 0')\n"
         "    aliases=' JOIN jobs j0"),
        ("    c.execute('CREATE VIEW IF NOT EXISTS gap_terminal_candidates_v1", "    c.execute('DROP VIEW IF EXISTS gap_terminal_candidates_v1')\n"
         "    c.execute('CREATE VIEW gap_terminal_candidates_v1"),
        ("'+reader_state+' AS reader_state,coalesce", "'+reader_state+' AS reader_state,(json_extract(CASE WHEN json_valid(e.result)THEN e.result ELSE \\'{}\\'END,\\'$.clarification\\')IS NOT NULL)AS input_pending,coalesce"),
        ("        c.execute('CREATE TRIGGER IF NOT EXISTS '+name", "        c.execute('DROP TRIGGER IF EXISTS '+name)\n        c.execute('CREATE TRIGGER '+name"),
        ('gap_terminal_seen(tenant,rid,jid,revision,queued_revision,reason,reader_state)',
         'gap_terminal_seen(tenant,rid,jid,revision,queued_revision,reason,reader_state,input_pending)'),
        ('SELECT tenant,rid,jid,1,0,reason,reader_state FROM', 'SELECT tenant,rid,jid,1,0,reason,reader_state,input_pending FROM'),
        ('reason=excluded.reason,reader_state=excluded.reader_state',
         'reason=excluded.reason,reader_state=excluded.reader_state,input_pending=excluded.input_pending'),
        ('gap_terminal_seen.reader_state!=excluded.reader_state;',
         'gap_terminal_seen.reader_state!=excluded.reader_state OR gap_terminal_seen.input_pending!=excluded.input_pending;'),
        ('gap_terminal_outbox(tenant,rid,jid,revision,created,reason,reader_state)',
         'gap_terminal_outbox(tenant,rid,jid,revision,created,reason,reader_state,input_pending)'),
        ("SELECT s.tenant,s.rid,s.jid,s.revision,v.created,s.reason,s.reader_state FROM",
         "SELECT s.tenant,s.rid,s.jid,s.revision,v.created,s.reason,s.reader_state,v.input_pending FROM"),
        ("outcome='CANCELED'if row['reason']=='CANCELED'", "outcome=('NEEDS_CLARIFICATION'if row['input_pending']else'READY')if row['reason']=='NEEDS_CLARIFICATION'else'CANCELED'if row['reason']=='CANCELED'")]
    for before, after in replacements:
        text = base.replace_once(text, before, after)
    return text


def build(source, destination):
    return base.build(source, destination, transform=sources,
                      marker=('template_clarification_overlay', 'template-clarification-v1'))
