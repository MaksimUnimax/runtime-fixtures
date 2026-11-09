import unittest
from decimal import Decimal
from semantics import Rejected
from read_surface import project_response
class MoneyArticle(unittest.TestCase):
 def test_price_object_and_article_spaces(self):
  d={'postings':[{'products':[{'offer_id':'Товар с пробелами / L','price':{'amount':'123.45','currency':'RUB','customer':'PRIVATE'}}]}]}
  r=project_response('ozon','fbs_posting_list',d);x=r['postings'][0]['products'][0];self.assertEqual(x['offer_id'],'Товар с пробелами / L');self.assertEqual(x['price'],{'amount':'123.45','currency':'RUB'});self.assertNotIn('PRIVATE',str(r))
 def test_scalar_price_still_supported(self):
  for v in ['123.45',Decimal('123.45'),123]:self.assertEqual(project_response('ozon','fbs_posting_list',{'price':v})['price'],v)
 def test_bad_money_not_accepted(self):
  for v in [{'amount':'nan','currency':'RUB'},{'amount':'123','currency':'bad'},{'unknown':'PRIVATE'},{'amount':None,'currency':'RUB'}]:
   with self.assertRaises(Rejected):project_response('ozon','fbs_posting_list',{'price':v})
 def test_article_control_characters_blocked(self):
  for ch in ['\n', '\x7f', '\x85', '\x9f', '\u200b', '\u202e']:
   with self.subTest(ch=repr(ch)):
    with self.assertRaises(Rejected):project_response('ozon','fbs_posting_list',{'offer_id':'abc'+ch+'secret'})

 def test_non_contact_at_sign_in_article(self):
  for v in ['SKU@batch','Товар @ L']:
   self.assertEqual(project_response('ozon','fbs_posting_list',{'offer_id':v})['offer_id'],v)
