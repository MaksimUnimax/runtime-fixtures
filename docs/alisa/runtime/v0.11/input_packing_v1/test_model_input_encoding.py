"""Data preservation and whole queued-answer retries; all provider IO is fake."""
import json
import random
import unittest
from unittest.mock import patch

import model_input_encoding as encoding
from semantics import canonical_json, strict_json
from model_answer import API_DATA, PENDING, Settings, messages
from engine import Engine, Worker, CallError
from repository import Repository
import model_usage
import test_model_answer as answers


def unpack(document):
    """Independent test decoder; no decoder runs in the product."""
    def restore(item):
        if isinstance(item, list):
            return [restore(v) for v in item]
        if isinstance(item, dict):
            assert set(item) == {'@', 'v'}
            fields = document['schemas'][item['@']]
            assert len(fields) == len(item['v'])
            return {key: restore(value) for key, value in zip(fields, item['v'])}
        return item
    return restore(document['data'])


def decode_content(text):
    assert text.startswith(encoding.PREFIX)
    text = text[len(encoding.PREFIX):]
    if text.startswith(encoding.V1_INSTRUCTION):
        return unpack(json.loads(text[len(encoding.V1_INSTRUCTION):]))
    return json.loads(text)


def dataset():
    return {'rows': [
        {'product_identifier': 'SKU-' + str(i), 'quantity_sold': i % 7,
         'amount_before_deductions': i * 19.5, 'nested': {'status': 'продажа', 'missing': None},
         'sparse': {'zero': 0} if i % 2 else {}, 'literal': {'@': 0, 'v': ['schemas', 'data']}}
        for i in range(80)]}


class Encoding(unittest.TestCase):
    def test_types_missing_colliding_keys_unicode_and_repeats_roundtrip(self):
        item = {'@': 3, 'v': ['x'], 'schemas': None, 'data': [], '': 'ключ\n',
                'values': [None, False, True, 0, 1, 1.0, -0.0, 9007199254740993,
                           -123.45, 1e-20, '001', 'null', '', '\t"\\😀']}
        root = {'rows': [item, item, {'missing': None}, {}]}
        self.assertEqual(canonical_json(unpack(encoding.pack_v1(root))), canonical_json(root))

    def test_generated_nested_values_preserve_canonical_json(self):
        rng = random.Random(35)
        def value(depth):
            if depth == 0:return rng.choice([None, True, False, -0.0, 12.5, '12.5', 'ё\n'])
            kind = rng.randrange(3)
            if kind == 0:return [value(depth-1) for _ in range(rng.randrange(5))]
            if kind == 1:return {str(i):value(depth-1) for i in range(rng.randrange(5))}
            return value(0)
        for _ in range(100):
            root = value(4)
            self.assertEqual(canonical_json(unpack(encoding.pack_v1(root))), canonical_json(root))

    def test_threshold_counts_unicode_characters_not_bytes(self):
        for size in (9999, 10000, 10001):
            root = {'text': 'я' * (size - len(canonical_json({'text': ''})))}
            self.assertEqual(len(canonical_json(root)), size)
            with patch.object(encoding, 'pack_v1', wraps=encoding.pack_v1) as pack:
                encoding.content(root, 1)
                self.assertEqual(pack.call_count, int(size >= 10000))

    def test_long_unrepeated_text_uses_original_with_instruction_in_comparison(self):
        root = {'text': 'x' * 15000}
        self.assertEqual(encoding.content(root, 1), encoding.PREFIX + canonical_json(root))

    def test_smaller_packed_message_keeps_all_values_without_mutation(self):
        root = dataset(); before = canonical_json(root)
        result = encoding.content(root, 1)
        self.assertTrue(result.startswith(encoding.PREFIX + encoding.V1_INSTRUCTION))
        self.assertLess(len(result), len(encoding.PREFIX + before))
        self.assertEqual(canonical_json(decode_content(result)), before)
        self.assertEqual(canonical_json(root), before)

    def test_reordered_dictionary_after_database_reload_is_identical(self):
        root = dataset()
        self.assertEqual(encoding.content(root, 1), encoding.content(strict_json(canonical_json(root)), 1))

    def test_encoder_recursion_failure_falls_back_without_extra_calls(self):
        root = dataset()
        with patch.object(encoding, 'pack_v1', side_effect=RecursionError):
            self.assertEqual(encoding.content(root, 1), encoding.PREFIX + canonical_json(root))

    def test_original_question_clarifications_and_three_prompts_are_preserved(self):
        result = messages('  ИсХодный вопрос? ', dataset(), 'Уточнение', ['Продолжение'],
                          'Ответь по данным', input_encoding=1)
        self.assertEqual([m['content'] for m in result[:-1]],
                         ['Ответь по данным', 'Уточнение', '  ИсХодный вопрос? ', 'Продолжение'])
        self.assertEqual(decode_content(result[-1]['content']), dataset())


class QueuedAnswer(unittest.TestCase):
    setUp = answers.AnswerFlow.setUp
    tearDown = answers.AnswerFlow.tearDown
    ask = answers.AnswerFlow.ask
    run_job = answers.AnswerFlow.run_job
    save = answers.AnswerFlow.save

    def pending(self):
        reply = self.ask(); self.worker.step()
        row = self.repo.get('A', reply['job_id'])
        progress = strict_json(row['progress'])
        self.assertIn(PENDING, progress)
        progress[API_DATA][0]['data'] = dataset()
        # A second API response and selected speech notes must survive together.
        progress[API_DATA].append({'operation': 'wb_orders', 'store': 'wb1',
                                  'params': {'date': '2026-11-08'}, 'data': {'empty': [], 'error': None}})
        progress[PENDING]['data'] = {'templates': progress[PENDING]['data'],
            'template_context': [{'notes': ['Точное примечание'], 'template_id': 'fixture'}]}
        with self.repo.connection(True) as c:
            c.execute('UPDATE jobs SET progress=? WHERE id=?', (canonical_json(progress), row['id']))
        return reply, progress

    def restart(self):
        self.repo = Repository(self.repo.path, self.clock)
        self.engine = Engine(self.repo, lambda t: self.scope, read_surface=self.reads,
                             answer_settings=Settings(self.settings.path))
        self.worker = Worker(self.engine, self.transport)

    def test_packed_429_retry_restart_pins_version_and_keeps_usage(self):
        reply, progress = self.pending()
        self.transport.failures = [CallError('HTTP_429', status=429, retry_at=self.clock()+20)]
        self.worker.step()
        saved = strict_json(self.repo.get('A', reply['job_id'])['progress'])
        self.assertEqual(saved['_answer_input_encoding'], 1)
        self.assertEqual(saved[API_DATA], progress[API_DATA])
        self.assertNotIn('schemas', saved)
        self.save(answer_prompt='Изменённый промпт'); self.restart()
        with patch.object(encoding, 'CURRENT_VERSION', 0):
            result = self.run_job(reply)
        self.assertEqual(result['state'], 'READY', result['error'])
        self.assertIsNone(result['progress'])
        first, second = self.transport.answer_calls
        self.assertEqual(first.body, second.body)
        text = first.body['messages'][-1]['content']
        self.assertTrue(text.startswith(encoding.PREFIX + encoding.V1_INSTRUCTION))
        restored = decode_content(text)
        self.assertEqual(restored['responses'], progress[API_DATA])
        self.assertEqual(restored['template_context'], progress[PENDING]['data']['template_context'])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 2)
        self.assertEqual([r.operation for r in self.transport.calls].count('ozon_orders'), 1)

    def test_already_started_legacy_answer_keeps_raw_json_after_restart(self):
        reply, progress = self.pending()
        progress['_answer_instruction_snapshot'] = self.settings.read()
        with self.repo.connection(True) as c:
            c.execute('UPDATE jobs SET progress=? WHERE id=?', (canonical_json(progress), reply['job_id']))
        self.restart(); result = self.run_job(reply)
        self.assertEqual(result['state'], 'READY', result['error'])
        text = self.transport.answer_calls[0].body['messages'][-1]['content']
        self.assertFalse(text.startswith(encoding.PREFIX + encoding.V1_INSTRUCTION))
        self.assertEqual(decode_content(text)['responses'], progress[API_DATA])


if __name__ == '__main__':
    unittest.main()
