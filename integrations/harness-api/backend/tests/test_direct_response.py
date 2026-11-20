from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from direct_response import clean_pages, render_fragments, compound_text


class DirectResponseTests(unittest.TestCase):
    def render(self, plan, data, contexts=(), **kwargs):
        return render_fragments(plan, data, '2026-11-18 UTC', contexts,
            provider_render=lambda *_args: {'complete': True, 'pages': ['Принято']},
            template_catalog={}, parameter_definition=lambda _: {'label': 'Коэффициент'},
            report_definition=lambda _: {'outputs': {'amount': {'label': 'Расчёт'}}}, **kwargs)

    def test_same_template_two_stores_never_overwrites_first_amount(self):
        fragments = [{'id': 'fragment-' + store, 'kind': 'parameterized', 'template_ids': ['report'],
                      'plan': {'parameter_report': {'template_id': 'report'}, 'stores': [
                          {'id': store, 'platform': 'ozon', 'identity': store}]}}
                     for store in ('first', 'second')]
        contexts = [{'template_id': 'report', 'estimates': {'amount': {'value': value, 'unit': 'RUB'}}}
                    for value in ('100', '200')]
        pages = self.render({'fragments': fragments}, {'templates': [
            {'template_ids': ['report'], 'data': {}} for _ in fragments]}, contexts,
            store_names={'first': 'Магазин А', 'second': 'Магазин Б'})
        self.assertEqual(pages, ['Магазин А', 'Расчёт: 100 ₽.', 'Магазин Б', 'Расчёт: 200 ₽.'])

    def test_mismatched_fragment_data_and_context_count_fail(self):
        fragment = {'id': 'one', 'kind': 'parameterized', 'template_ids': ['report'],
                    'plan': {'parameter_report': {'template_id': 'report'}}}
        for data, contexts in [({'templates': []}, []),
            ({'templates': [{'template_ids': ['other'], 'data': {}}]}, [{'template_id': 'report'}]),
            ({'templates': [{'template_ids': ['report'], 'data': {}}]}, [])]:
            with self.assertRaises(ValueError):
                self.render({'fragments': [fragment]}, data, contexts)

    def test_information_only_currently_available_templates(self):
        pages = self.render({'fragments': [{'kind': 'information', 'template_ids': ['help'], 'plan': None}]},
            {'templates': [{'template_ids': ['help'], 'data': {'capabilities': [
                {'purpose': 'Заказы', 'available_stores': ['allowed']},
                {'purpose': 'Чужие данные', 'available_stores': []}]}}]})
        self.assertIn('Заказы', pages[0]); self.assertNotIn('Чужие', pages[0])

    def test_parameter_preserves_numeric_zero_unit_and_period(self):
        pages = self.render({'fragments': [{'kind': 'parameter', 'template_ids': ['coefficient'], 'plan': {}}]},
            {'templates': [{'template_ids': ['coefficient'], 'data': {'parameter': 'delivery_mean', 'value': '0',
              'unit': 'RUB/ordered_unit', 'period': {'from': '2026-01-01', 'to': '2026-10-31'}}}]})
        self.assertIn('0 ₽ на заказанную единицу', pages[0])
        self.assertIn('2026-01-01 — 2026-10-31', pages[0])

    def test_economics_missing_owner_inputs_are_not_zero_or_profit(self):
        result = {'schema': 'alisa-qualified-economics/v1', 'scenarios': {'with_loss': {
            'totals': {'original_units': '10', 'revenue': '1234.567', 'drr_percent': None},
            'owner_inputs_complete': False, 'after_declared_owner_inputs': None,
            'unknown_owner_inputs': ['tax_amount'], 'per_original_unit': {'revenue': '123.4567'}}}}
        text = compound_text({'economics': result})
        self.assertIn('1234,57 ₽', text)
        self.assertIn('ДРР: не определено', text)
        self.assertIn('налоги не заданы числом', text)
        self.assertIn('не приняты за ноль', text)
        self.assertIn('не фактическая чистая прибыль', text)

    def test_clean_pages_keeps_qualifications(self):
        self.assertEqual(clean_pages(['Цифры API, без сверки. Скажите: дальше.', 'Знаменатель равен нулю.']),
                         ['Цифры API, без сверки.', 'Знаменатель равен нулю.'])


if __name__ == '__main__':
    unittest.main()
