"""Context-checked additions to the current native and Station releases."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace(text, before, after):
    if text.count(before) != 1:
        raise ValueError('LEGACY_CLARIFICATION_CONTEXT_MOVED')
    return text.replace(before, after)


def native_sources(root):
    result = {'legacy_voice.py': (ROOT / 'legacy_voice.py').read_text()}
    text = (root / 'engine.py').read_text()
    text = replace(text, '        self.execution_policy=execution_policy',
                   '        self.legacy_voice_authority=None\n        self.execution_policy=execution_policy')
    text = replace(text, '    def authorized(self,plan):',
                   "    def authorized(self,plan):\n        from legacy_voice import authorized\n        if not authorized(self,plan):return False\n"
                   "        if plan.get('schema')!='alice-template-execution/v1':plan={k:v for k,v in plan.items() if k!='station_guard'}")
    text = replace(text, "        if plan is not None and plan.get('runtime_guard')!=guard:raise Rejected('PERMISSION_DENIED')",
                   "        if plan is not None and plan.get('runtime_guard')!=guard:raise Rejected('PERMISSION_DENIED')\n"
                   "        if draft.get('station_guard') is not None or (plan or {}).get('station_guard') is not None:\n"
                   "            if plan is None or plan.get('station_guard')!=draft.get('station_guard') or not self.authorized(plan):raise Rejected('PERMISSION_DENIED')")
    text = replace(text, '        token=ORIGINAL_QUESTION.set(command)\n        try:',
                   "        from legacy_voice import SUBMISSION\n"
                   "        admission=None\n"
                   "        if self.legacy_voice_authority is not None and conversation_id is not None:\n"
                   "            admission=self.legacy_voice_authority.admit(tenant,conversation_id,request_id)\n"
                   "        voice_token=SUBMISSION.set(admission)\n"
                   "        token=ORIGINAL_QUESTION.set(command)\n        try:")
    text = replace(text, '            ORIGINAL_QUESTION.reset(token)',
                   '            ORIGINAL_QUESTION.reset(token)\n            SUBMISSION.reset(voice_token)')
    text = replace(text, "            guarded=strict_json(row['draft']).get('runtime_guard') is not None",
                   "            guarded=any(strict_json(row['draft']).get(k) is not None for k in ('runtime_guard','station_guard'))")
    text = replace(text, "            if strict_json(row['draft']).get('runtime_guard') is None:",
                   "            if all(strict_json(row['draft']).get(k) is None for k in ('runtime_guard','station_guard')):")
    for signature in ('    def access_failure_notice(self,row):',
                      '    def access_failure_result(self,row):', '    def output_authorized(self,row):'):
        # All output kinds, including safe tariff explanations, retain the
        # original Station authorization before returning any cached text.
        text = replace(text, signature, signature +
                       "\n        from legacy_voice import authorized as voice_authorized\n"
                       "        if row['plan'] and not voice_authorized(self,strict_json(row['plan'])):return None")
    text = replace(text, "            if not row or row['id']!=plan['job_id']:return False",
                   "            if not row or row['id']!=plan['job_id']:return False\n"
                   "            from legacy_voice import authorized as voice_authorized\n"
                   "            if row['plan'] and not voice_authorized(self,strict_json(row['plan'])):return False")
    result['engine.py'] = text
    text = (root / 'runtime.py').read_text()
    text = replace(text, '    transport=HTTPTransport(',
                   '    from legacy_voice import Authority\n    engine.legacy_voice_authority=Authority()\n    transport=HTTPTransport(')
    result['runtime.py'] = text
    text = (root / 'template_runtime.py').read_text()
    text = replace(text, '    if not authorized(engine,plan):raise Rejected(\'SOURCE_ACCESS\')\n    row,outcome=',
                   "    from legacy_voice import pin\n    pin(plan,draft)\n    if not engine.authorized(plan):raise Rejected('SOURCE_ACCESS')\n    row,outcome=")
    # Called directly by the worker as well as through Engine.authorized().
    text = replace(text, "        if plan.get('schema')!=SCHEMA", "        from legacy_voice import authorized as voice_authorized\n        if not voice_authorized(engine,plan):return False\n        if plan.get('schema')!=SCHEMA")
    text = replace(text, "and type(plan.get('runtime_guard'))is dict:",
                   "and (type(plan.get('runtime_guard'))is dict or __import__('legacy_voice').supported(worker.engine,plan)):")
    text = replace(text, "            if type(plan.get('runtime_guard'))is dict:ctx['clarification_supported']=True",
                   "            from legacy_voice import supported\n            if type(plan.get('runtime_guard'))is dict or supported(worker.engine,plan):ctx['clarification_supported']=True")
    text = replace(text, '    fragments=compile_selection(worker.engine,plan,decision)',
                   "    fragments=compile_selection(worker.engine,plan,decision)\n"
                   "    if plan.get('station_guard') is not None:\n"
                   "        for fragment in fragments:\n"
                   "            if fragment['plan'] is not None:fragment['plan']['station_guard']=deepcopy(plan['station_guard'])")
    result['template_runtime.py'] = text
    text = (root / 'dialogue.py').read_text()
    # Preserve the same template-only parser isolation on the immutable R02
    # input used by CI. Current installed sources already carry this behavior.
    if 'if not engine.template_mode and is_help(text)' not in text:
        for before, after in [
            ("    if is_help(text):text='помощь'", "    if not engine.template_mode and is_help(text):text='помощь'"),
            ('        short = _choice(text)', '        short = None if engine.template_mode else _choice(text)'),
            ('        query, changes = _normalize_request(text)', '        query, changes = (command, []) if engine.template_mode else _normalize_request(text)'),
            ("        if p and (p['scope_hash'] != scope_hash or p['compiler_pin'] != _pin(engine)):",
             "        if engine.template_mode:\n            p = None\n        elif p and (p['scope_hash'] != scope_hash or p['compiler_pin'] != _pin(engine)):"),
            ("        elif short or text in ('по дате заказа', 'по дате выкупа') or _short_date(query,today):",
             "        elif not engine.template_mode and (short or text in ('по дате заказа', 'по дате выкупа') or _short_date(query,today)):"),
            ("                if exc.code=='OZON_EVENT_SOURCE_UNAVAILABLE'", "                if not engine.template_mode and exc.code=='OZON_EVENT_SOURCE_UNAVAILABLE'"),
            ("                elif exc.code=='COHORT_REQUIRED'", "                elif not engine.template_mode and exc.code=='COHORT_REQUIRED'"),
            ('                elif _clarifiable(query, exc):', '                elif not engine.template_mode and _clarifiable(query, exc):')]:
            text = replace(text, before, after)
    text = replace(text, '                try:reply = engine._submit(tenant, query, inner_rid, body_hash, anchor, clarification=metadata)',
                   "                try:\n                    from legacy_voice import continue_selected\n"
                   "                    reply=continue_selected(engine,c,tenant,command) if engine.template_mode else None\n"
                   "                    if reply is None:reply = engine._submit(tenant, query, inner_rid, body_hash, anchor, clarification=metadata)")
    result['dialogue.py'] = text
    text = (root / 'template_clarification.py').read_text()
    text = replace(text, "        need(type(plan.get('runtime_guard')) is dict)",
                   "        from legacy_voice import supported\n        need(type(plan.get('runtime_guard')) is dict or supported(worker.engine,plan))")
    text = replace(text, "    worker.repo.complete_answer(row['id'], row['owner'], result)",
                   "    with worker.repo.connection(True) as c:\n"
                   "        worker.repo._owned(c,row['id'],row['owner'])\n"
                   "        if plan.get('station_guard') is not None:\n"
                   "            draft['station_question_pending']=True\n"
                   "            c.execute('UPDATE jobs SET draft=? WHERE id=?',(canonical_json(draft),row['id']))\n"
                   "        worker.repo.complete_answer(row['id'], row['owner'], result)")
    first = text.index('        need(not c.execute("SELECT 1 FROM calls')
    last = text.index("        key = 'clarify:'", first)
    prepare = text[first:last].replace('port.engine', 'engine')
    prepare = '\n'.join(line[4:] for line in prepare.rstrip().splitlines())
    first_queue = last
    last_queue = text.index("        c.execute('UPDATE reader_cursors", first_queue)
    queue = text[first_queue:last_queue].replace('port.repo', 'engine.repo')
    queue = queue.replace("        need(timestamp(ctx['not_after']) > now, 'AUTH_REQUIRED')\n", '')
    queue = '\n'.join(line[4:] for line in queue.rstrip().splitlines())
    text = text[:first] + ("        draft,plan,answers=prepare_resume(port.engine,c,row,answer,query['expected_revision'])\n"
        "        requeue(port.engine,c,row,draft,plan,answers,\n"
        "                before=lambda:need(timestamp(ctx['not_after']) > port.repo.clock(),'AUTH_REQUIRED'))\n"
        "        now=port.repo.clock()\n") + text[last_queue:]
    text += ("\n\ndef prepare_resume(engine,c,row,answer,revision):\n"
             "    value=pending(row)\n"
             "    need(value is not None and (row['expires'] or 0)>engine.repo.clock(),'RESULT_EXPIRED')\n"
             "    need(value['revision']==revision,'IDEMPOTENCY_CONFLICT')\n" + prepare +
             "\n    return draft,plan,answers\n\n\ndef requeue(engine,c,row,draft,plan,answers,before=None):\n"
             "    need(engine.authorized(plan),'PERMISSION_DENIED')\n"
             "    if before is not None:before()\n" + queue + "\n")
    result['template_clarification.py'] = text
    for name, source in result.items():
        compile(source, name, 'exec')
    return result


def station_sources(root):
    text = (root / 'service.py').read_text()
    text = replace(text, "        atomic(self.directory / 'state.json', json.dumps(self.state, ensure_ascii=False).encode())",
                   "        from station_authority import before_save,publish\n        before_save(self)\n"
                   "        atomic(self.directory / 'state.json', json.dumps(self.state, ensure_ascii=False).encode())\n"
                   "        publish(self)")
    text = replace(text, "            self.state.update(connected=False, binding=None, selected=None, scenario=None, job=None,",
                   "            from station_authority import invalidate\n            invalidate(self)\n"
                   "            self.state['voice_binding_revision']=self.state.get('voice_binding_revision',0)+1\n"
                   "            self.state.update(connected=False, binding=None, selected=None, scenario=None, job=None,")
    text = replace(text, "                    self.state['binding'] = {k: data[k] for k in ('tenant', 'application')}",
                   "                    self.state['voice_binding_revision']=self.state.get('voice_binding_revision',0)+1\n"
                   "                    self.state['binding'] = {k: data[k] for k in ('tenant', 'application')}")
    text = replace(text, "\n            if match and self.state['job']:\n",
                   "\n            if match:\n                from station_authority import refresh\n"
                   "                if refresh(self,data) or getattr(self,'voice_authority_view',None) is None:self.save()\n"
                   "            if match and self.state['job']:\n")
    text = replace(text, "                        receipts[data['rid']]=turn",
                   "                        from station_authority import remember\n                        remember(self,turn,data)\n"
                   "                        receipts[data['rid']]=turn")
    text = replace(text, "    ipc = Ingress(ipc_path, IngressHandler); ipc.delivery = core",
                   "    ipc = Ingress(ipc_path, IngressHandler); ipc.delivery = core\n"
                   "    import pwd\n    from station_authority import Server,Handler\n"
                   "    auth=Server('/run/alisa-station/authorization.sock',Handler)\n"
                   "    auth.registry=core;auth.allowed_uid=pwd.getpwnam('alice-market').pw_uid\n"
                   "    os.chmod('/run/alisa-station',0o710)\n"
                   "    os.chmod('/run/alisa-station/authorization.sock',0o660)\n"
                   "    threading.Thread(target=auth.serve_forever,daemon=True).start()")
    compile(text, 'service.py', 'exec')
    return {'service.py': text, 'station_authority.py': (ROOT / 'station_authority.py').read_text()}
