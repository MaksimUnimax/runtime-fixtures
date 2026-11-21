import copy
import unittest
from test_price_volume import fixture, amount
from signed_accrual_source import decode_page, summarize, SourceError

def reversal():
    d=fixture()
    a=d['accruals'][0]
    a['total_amount']=amount(-3000)
    for x in a['posting']['products'][0]['commission'].values():
        if isinstance(x,dict):x['amount']=str(-int(x['amount']))
    return d

class SignedAccrualTests(unittest.TestCase):
    def test_two_unit_reversal_is_not_a_positive_sale(self):
        rows,_=decode_page(reversal(),'2026-10-01',set());s=summarize(rows)
        self.assertEqual((s['gross_units'],s['reversal_units'],s['net_units']),(0,2,-2))
        self.assertEqual(s['net_buyer_amount'],'-1000')
        self.assertIsNone(s['mean_buyer_price'])

    def test_same_sku_sale_and_reversal_keep_gross_mean_and_net_separate(self):
        d=fixture();a=reversal()['accruals'][0];a['accrual_id']=2
        d['accruals'].append(a);rows,_=decode_page(d,'2026-10-01',set());s=summarize(rows)
        self.assertEqual((s['gross_units'],s['reversal_units'],s['net_units']),(2,2,0))
        self.assertEqual(s['mean_buyer_price'],'500')
        self.assertEqual(s['net_buyer_amount'],'0')

    def test_inconsistent_buyer_sign_is_rejected_even_when_components_balance(self):
        d=reversal();c=d['accruals'][0]['posting']['products'][0]['commission']
        c['sale_price']=amount(1000);c['bonus']=amount(-4990)
        with self.assertRaisesRegex(SourceError,'INCONSISTENT_DIRECTION'):decode_page(d,'2026-10-01',set())

    def test_reversal_still_requires_posting_control(self):
        d=reversal();d['accruals'][0]['total_amount']=amount(-2999)
        with self.assertRaisesRegex(SourceError,'POSTING_RECONCILIATION'):decode_page(d,'2026-10-01',set())

    def test_return_quantity_must_not_be_negated_twice(self):
        d=reversal();d['accruals'][0]['posting']['products'][0]['quantity']=-2
        with self.assertRaisesRegex(SourceError,'QUANTITY_SCHEMA'):decode_page(d,'2026-10-01',set())

    def test_duplicate_reversal_is_not_counted_twice(self):
        d=reversal();d['accruals'].append(copy.deepcopy(d['accruals'][0]))
        with self.assertRaisesRegex(SourceError,'DUPLICATE_ACCRUAL'):decode_page(d,'2026-10-01',set())

    def test_actual_zero_buyer_price_differs_from_no_sale(self):
        d=fixture();c=d['accruals'][0]['posting']['products'][0]['commission']
        c['sale_price']=amount(0);c['bonus']=amount(3990)
        rows,_=decode_page(d,'2026-10-01',set())
        self.assertEqual(summarize(rows)['mean_buyer_price'],'0')
        self.assertIsNone(summarize([])['mean_buyer_price'])

if __name__=='__main__':unittest.main()
