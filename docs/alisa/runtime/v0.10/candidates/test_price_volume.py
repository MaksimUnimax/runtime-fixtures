import copy
import unittest
from price_volume import decode_page, summarize, SourceError, pearson

def amount(x):
    return {'amount':str(x),'currency':'RUB'}

def fixture(quantity=2):
    return {'accruals':[{'accrual_id':1,'date':'2026-10-01','total_amount':amount(3000),
      'posting':{'products':[{'sku':100,'quantity':quantity,'delivery':None,
       'commission':{'seller_price':amount(2000),'sale_price':amount(1000),
       'sale_amount':amount(4000),'bonus':amount(2990),'coinvestment':amount(10),
       'sale_commission':amount(-1000),'commission_ratio':'value:"0.25"'}}]}}], 'last_id':''}

class PriceVolumeTests(unittest.TestCase):
    def test_multiquantity_sale_price_is_line_amount(self):
        rows,c=decode_page(fixture(),'2026-10-01',set())
        r=summarize(rows,['2026-10-01'])
        self.assertEqual(r['totals']['quantity'],2)
        self.assertEqual(r['totals']['buyer_amount'],'1000')
        self.assertEqual(r['totals']['mean_price'],'500')

    def test_same_sku_distinct_realizations_are_preserved(self):
        d=fixture();other=copy.deepcopy(d['accruals'][0]);other['accrual_id']=2
        other['posting']['products'][0]['commission']['sale_price']=amount(1200)
        other['posting']['products'][0]['commission']['bonus']=amount(2790)
        d['accruals'].append(other)
        rows,_=decode_page(d,'2026-10-01',set());r=summarize(rows,['2026-10-01'])
        self.assertEqual(len(rows),2)
        self.assertEqual(r['totals']['quantity'],4)
        self.assertEqual(r['totals']['mean_price'],'550')

    def test_duplicate_accrual_fails(self):
        d=fixture();d['accruals'].append(copy.deepcopy(d['accruals'][0]))
        with self.assertRaisesRegex(SourceError,'DUPLICATE_ACCRUAL'):decode_page(d,'2026-10-01',set())

    def test_other_day_is_not_silently_included(self):
        with self.assertRaisesRegex(SourceError,'DATE_AXIS'):decode_page(fixture(),'2026-10-02',set())

    def test_mixed_currency_fails(self):
        d=fixture();d['accruals'][0]['posting']['products'][0]['commission']['sale_price']['currency']='BYN'
        with self.assertRaisesRegex(SourceError,'MONEY_CURRENCY'):decode_page(d,'2026-10-01',set())

    def test_component_difference_fails(self):
        d=fixture();d['accruals'][0]['posting']['products'][0]['commission']['bonus']=amount(2900)
        with self.assertRaisesRegex(SourceError,'PRICE_LINE_RECONCILIATION'):decode_page(d,'2026-10-01',set())

    def test_seller_unit_vs_line_is_checked(self):
        d=fixture(1)
        with self.assertRaisesRegex(SourceError,'SELLER_UNIT_RECONCILIATION'):decode_page(d,'2026-10-01',set())

    def test_unknown_returns_are_rejected(self):
        d=fixture(-2)
        with self.assertRaisesRegex(SourceError,'QUANTITY_OR_RETURN_NOT_QUALIFIED'):decode_page(d,'2026-10-01',set())

    def test_posting_control_is_not_repeated_per_product(self):
        d=fixture();second=copy.deepcopy(d['accruals'][0]['posting']['products'][0]);second['sku']=200
        d['accruals'][0]['posting']['products'].append(second);d['accruals'][0]['total_amount']=amount(6000)
        rows,c=decode_page(d,'2026-10-01',set())
        self.assertEqual(len(rows),2);self.assertEqual(c['posting_rows'],1)

    def test_explicit_zero_price_and_missing_sales_day(self):
        d=fixture();c=d['accruals'][0]['posting']['products'][0]['commission']
        c['sale_price']=amount(0);c['bonus']=amount(3990)
        rows,_=decode_page(d,'2026-10-01',set());r=summarize(rows,['2026-10-01','2026-10-02'])
        self.assertEqual(r['daily'][0]['mean_price'],'0')
        self.assertIsNone(r['daily'][1]['mean_price'])

    def test_opaque_commission_ratio_not_used_as_money(self):
        rows,c=decode_page(fixture(),'2026-10-01',set());self.assertEqual(c['opaque_ratio_rows'],1)

    def test_no_sales_is_not_a_zero_price(self):
        r=summarize([],['2026-10-01']);self.assertIsNone(r['totals']['mean_price'])

    def test_non_finite_or_missing_money_fails(self):
        d=fixture();d['accruals'][0]['posting']['products'][0]['commission']['sale_price']=amount('NaN')
        with self.assertRaisesRegex(SourceError,'MONEY_RANGE'):decode_page(d,'2026-10-01',set())

    def test_correlation_constant_and_known_linear_data(self):
        self.assertIsNone(pearson([1,1,1],[1,2,3]))
        self.assertAlmostEqual(pearson([1,2,3],[6,4,2]),-1)

if __name__=='__main__':unittest.main()
