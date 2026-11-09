"""Only fixed error taxonomy leaves the transport. No bodies, tokens or retries."""
import io,json,unittest,urllib.error
from unittest.mock import patch
from dataclasses import asdict
from provider_denial import diagnose_denial,MAX_DIAGNOSTIC_BYTES
from test_runtime import OZ
import test_read_transport as tf
import read_surface as rs
from engine import CallError
URL='https://api-seller.ozon.ru/v2/review/count'
class Diagnosis(unittest.TestCase):
 def d(self,msg,code=7,status=403,url=URL):return diagnose_denial('read.ozon.review_count',url,status,json.dumps({'code':code,'message':msg}).encode())
 def test_active_subscription_mention_is_not_a_purchase_requirement(self):self.assertEqual(self.d('Premium Plus subscription active; access denied')['public_code'],'HTTP_403')
 def test_subscription_name_without_requirement_not_enough(self):self.assertEqual(self.d('Premium Plus subscription')['public_code'],'HTTP_403')
 def test_explicit_subscription(self):self.assertEqual(self.d('Premium Plus subscription is required')['public_code'],'HTTP_403_OZON_SUBSCRIPTION_REQUIRED')
 def test_no_paid_claim_from_generic_403(self):self.assertEqual(self.d('access denied')['public_code'],'HTTP_403')
 def test_explicit_permission(self):self.assertEqual(self.d('insufficient permissions for method')['public_code'],'HTTP_403_OZON_METHOD_PERMISSION')
 def test_other_host_not_classified_as_ozon(self):self.assertEqual(self.d('Premium Plus subscription required',url='https://invalid.example')['public_code'],'HTTP_403')
 def test_500_not_changed(self):self.assertEqual(self.d('Premium Plus subscription required',status=500)['public_code'],'HTTP_500')
 def test_no_raw_message_or_secrets_exported(self):
  p=self.d('Premium Plus subscription required PRIVATE_PHONE private@example.invalid');self.assertNotIn('PRIVATE',json.dumps(p));self.assertNotIn('example.invalid',json.dumps(p))
 def test_large_body_not_parsed(self):self.assertEqual(diagnose_denial('x',URL,403,b'x'*(MAX_DIAGNOSTIC_BYTES+1))['body_format'],'NOT_PARSED')
 def test_duplicate_keys_invalid(self):self.assertEqual(diagnose_denial('x',URL,403,b'{"code":7,"code":1,"message":"x"}')['body_format'],'NOT_PARSED')
 def test_html_not_echoed(self):self.assertNotIn('<html>',json.dumps(diagnose_denial('x',URL,403,b'<html>PRIVATE</html>')))
 def test_utf8_error_keeps_status(self):self.assertEqual(diagnose_denial('x',URL,403,b'\xff')['public_code'],'HTTP_403')
 def test_missing_message_no_claim(self):self.assertEqual(diagnose_denial('x',URL,403,b'{"code":7}')['public_code'],'HTTP_403')
class Transport(unittest.TestCase):
 setUp=tf.ReadTransport.setUp;tearDown=tf.ReadTransport.tearDown
 def test_received_error_preserves403_and_closes(self):
  body=io.BytesIO(b'{"code":7,"message":"Premium Plus subscription required PRIVATE"}');err=urllib.error.HTTPError(URL,403,'Forbidden',{},body)
  req=rs.request_for(asdict(OZ),'review_count',{})
  with patch('http_transport.read_response',side_effect=err),patch('builtins.print')as output:
   with self.assertRaises(CallError)as caught:self.t.execute(req,asdict(OZ))
  self.assertEqual(caught.exception.status,403);self.assertEqual(caught.exception.code,'HTTP_403_OZON_ACCESS_POLICY_CONFLICT');self.assertFalse(caught.exception.unknown);self.assertTrue(body.closed);self.assertNotIn('PRIVATE',str(output.call_args_list))
 def test_buffer_parse_error_does_not_erase_received_status(self):
  err=urllib.error.HTTPError(URL,403,'Forbidden',{},io.BytesIO(b'{bad'))
  with patch('http_transport.read_response',side_effect=err),patch('builtins.print'):
   with self.assertRaises(CallError)as caught:self.t.execute(rs.request_for(asdict(OZ),'review_count',{}),asdict(OZ))
  self.assertEqual(caught.exception.code,'HTTP_403');self.assertFalse(caught.exception.unknown)
if __name__=='__main__':
 r=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Diagnosis,Transport]));print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'provider_http':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
