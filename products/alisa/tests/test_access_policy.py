import sys
import unittest
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/platform/src'))
from alisa_platform.entitlements.policy import gift_input, append_interval, access_state


class AccessPolicy(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2028, 2, 28, 23, 30, tzinfo=timezone.utc)
        self.limits = {'days': 30, 'recipients': 10, 'budget': 300}
        self.value = {'customer_ids': [str(uuid.uuid4())], 'days': 7, 'source': 'GIFT',
                      'reason': 'PILOT_ACCESS', 'notify': True, 'comment': '', 'policy': 'AFTER_LAST_SCHEDULED'}

    def test_days_are_exact_seconds_across_leap_and_dst_dates(self):
        for now in [self.now, datetime(2027, 3, 27, 23, 30, tzinfo=timezone.utc)]:
            start, end = append_interval(now, [], 7)
            self.assertEqual(start, now)
            self.assertEqual((end-start).total_seconds(), 7*86400)

    def test_expired_intervals_do_not_delay_new_access(self):
        self.assertEqual(append_interval(self.now, [(self.now-timedelta(days=4), self.now-timedelta(days=1))], 7)[0], self.now)

    def test_gap_is_preserved_and_chain_is_not_silently_filled(self):
        start, end = append_interval(self.now, [(self.now, self.now+timedelta(days=1)),
              (self.now+timedelta(days=3), self.now+timedelta(days=4))], 7)
        self.assertEqual(start, self.now+timedelta(days=4))
        self.assertEqual(access_state(self.now+timedelta(days=2), [(self.now, self.now+timedelta(days=1)), (start,end)])[0], 'SCHEDULED')

    def test_left_closed_right_open_and_continuous_coverage(self):
        end=self.now+timedelta(days=7)
        self.assertEqual(access_state(self.now, [(self.now,end)]), ('ACTIVE',end))
        self.assertEqual(access_state(end, [(self.now,end)]), ('EXPIRED',None))
        self.assertEqual(access_state(self.now, [(self.now,end),(end,end+timedelta(days=7))]), ('ACTIVE',end+timedelta(days=7)))

    def test_scalar_and_budget_limits(self):
        for value in [True, False, 7.0, '7', 0, -1, 31, 10**20]:
            with self.subTest(value=value), self.assertRaises((ValueError,TypeError)):
                gift_input({**self.value,'days':value},self.limits)
        small={**self.limits,'budget':6}
        with self.assertRaises(ValueError):gift_input(self.value,small)

    def test_duplicate_recipients_and_untrusted_product_or_payment(self):
        for patch in [{'customer_ids':self.value['customer_ids']*2}, {'product_id':'other'},
                      {'source':'PAYMENT'}, {'source':'TRIAL'}, {'notify':1}, {'policy':'FILL_GAPS'},
                      {'comment':'private\ntext'}, {'customer_ids':[]}, {'customer_ids':['not-a-uuid']}]:
            with self.subTest(patch=patch), self.assertRaises((ValueError,TypeError)):
                gift_input({**self.value,**patch},self.limits)

    def test_compensation_remains_nonpayment(self):
        value=gift_input({**self.value,'source':'COMPENSATION'},self.limits)
        self.assertEqual(value['source'],'COMPENSATION')
        self.assertNotIn('paid',value)


if __name__ == '__main__':unittest.main()
