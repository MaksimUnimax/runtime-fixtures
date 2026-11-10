"""Plain model answers from the original question and received API data.

No answer schema, executable expressions, or model-specific result vocabulary.
The existing worker owns network calls, accounting, access and retry policy.
"""
import json
import os
import tempfile
import threading
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path

from semantics import Rejected, canonical_json, strict_json
import model_input_encoding

ORIGINAL_QUESTION = ContextVar('answer_original_question', default=None)
API_DATA = '_answer_api_data'
PENDING = '_answer_pending'
DEFAULTS = {
    'request_planning_prompt': 'Разбери запрос пользователя и подбери нужные шаблоны для получения данных, необходимых для ответа. Сохрани все условия исходного вопроса.',
    'answer_prompt': 'Ответь на вопрос пользователя, используя эти данные.',
    'answer_extra_instruction': '',
}


class Settings:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            if not self.path.exists():
                return {'revision': 0, **DEFAULTS}
            return {**DEFAULTS, **json.loads(self.path.read_text(encoding='utf-8'))}

    def save(self, revision, **values):
        if type(revision) is not int or set(values) != set(DEFAULTS) or any(type(v) is not str for v in values.values()):
            raise Rejected('ANSWER_SETTINGS_SCHEMA')
        with self.lock:
            current = self.read()
            if revision != current['revision']:
                raise Rejected('ANSWER_SETTINGS_CHANGED_RELOAD')
            value = {'revision': revision + 1, **{k:v if v.strip() else '' for k,v in values.items()}}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix='.answer-settings-', dir=self.path.parent)
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, 'w') as stream:
                    json.dump(value, stream, ensure_ascii=False)
                    stream.flush(); os.fsync(stream.fileno())
                os.replace(name, self.path)
                directory = os.open(self.path.parent, os.O_RDONLY)
                try: os.fsync(directory)
                finally: os.close(directory)
            finally:
                Path(name).unlink(missing_ok=True)
            return value


def messages(question, api_data, instruction='', clarifications=(), prompt=DEFAULTS['answer_prompt'], *, input_encoding=0):
    result = []
    if prompt.strip():result.append({'role': 'system', 'content': prompt})
    if instruction.strip():
        result.append({'role': 'system', 'content': instruction})
    result.append({'role': 'user', 'content': question})
    for clarification in clarifications:
        result.append({'role': 'user', 'content': clarification})
    result.append({'role': 'user', 'content': model_input_encoding.content(api_data, input_encoding)})
    return result


def pages(text):
    """Only the channel's page size is applied; content is not rewritten."""
    result = []
    while text:
        cut = min(850, len(text))
        if cut < len(text):
            space = text.rfind(' ', 0, cut)
            if space > 0:cut = space
        result.append(text[:cut])
        text = text[cut:]
    return result


def step(worker, row, plan, progress):
    from providers import Request
    draft = strict_json(row['draft'])
    from provider_failure import notice_authorized
    def authorized():
        return notice_authorized(worker.engine,row) if progress[PENDING].get('permission_notice') else worker.engine.authorized(plan)
    if not authorized():raise Rejected('SOURCE_ACCESS')
    # Snapshot immediately before the first dispatch, once for every retry.
    if '_answer_instruction_snapshot' not in progress:
        progress['_answer_instruction_snapshot'] = worker.engine.answer_settings.read()
        progress['_answer_input_encoding'] = model_input_encoding.CURRENT_VERSION
        with worker.repo.connection(True) as connection:
            worker.repo._owned(connection, row['id'], row['owner'])
            connection.execute('UPDATE jobs SET progress=? WHERE id=?', (canonical_json(progress), row['id']))
    api_data = progress[API_DATA]
    result_data = progress[PENDING].get('data')
    template_context = result_data.get('template_context') if type(result_data) is dict else None
    if template_context:
        api_data = {'responses': api_data, 'template_context': template_context}
    body = {'messages': messages(draft['original_question'], api_data,
                                progress['_answer_instruction_snapshot']['answer_extra_instruction'], draft.get('question_clarifications', []),
                                progress['_answer_instruction_snapshot']['answer_prompt'],
                                input_encoding=progress.get('_answer_input_encoding', 0))}
    request = Request('model_answer', worker.transport.model_source, '', body, 0, None)
    def received(response):
        if not authorized():raise Rejected('SOURCE_ACCESS')
        result = dict(progress[PENDING], complete=True, pages=pages(response['content']))
        worker.repo.complete_answer(row['id'], row['owner'], result)
    worker._call(row, request, on_received=received)


def stage_universal(worker, row, progress):
    stamp = datetime.fromtimestamp(worker.repo.clock(), timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    worker.repo.stage_answer(row['id'], row['owner'], {
        'data': {'calls': progress['calls']}, 'fetched_at': stamp}, progress)


def planning_prompt(worker, row):
    draft = strict_json(row['draft'])
    if not draft.get('answer_by_model'):return None
    if 'request_planning_prompt' not in draft:
        draft['request_planning_prompt'] = worker.engine.answer_settings.read()['request_planning_prompt']
        with worker.repo.connection(True) as connection:
            worker.repo._owned(connection,row['id'],row['owner'])
            connection.execute('UPDATE jobs SET draft=? WHERE id=?',(canonical_json(draft),row['id']))
    return draft['request_planning_prompt']


