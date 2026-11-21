import io,json,os,unittest
from types import SimpleNamespace
from unittest.mock import patch
import service

class AdminUsageBoundary(unittest.TestCase):
    def test_owner_role_and_product_are_both_required(self):
        for role,product,accepted in [('OWNER','alisa_market',True),('ADMIN','alisa_market',False),('OWNER','other_product',False)]:
            response=io.BytesIO(json.dumps({'staff':{'role':role,'product_id':product}}).encode())
            opener=SimpleNamespace(open=lambda *a,**kw:response)
            with patch.object(service,'staff_cookie',return_value='fixture'),patch.dict(os.environ,{'ALISA_PLATFORM_URL':'http://127.0.0.1:18102','ALISA_STAFF_SERVICE_TOKEN':'synthetic'}),patch.object(service.urllib.request,'build_opener',return_value=opener):
                if accepted:self.assertEqual(service.staff_profile('fixture')['role'],'OWNER')
                else:
                    with self.assertRaises(service.Fault):service.staff_profile('fixture')

    def test_customer_route_rejects_model_usage(self):
        handler=service.AdminHandler.__new__(service.AdminHandler);body=b'{"action":"model_usage"}'
        handler.path=service.SITE_BASE+'api';handler.headers={'Host':'alisa.octoport.ru','Origin':service.SITE_ORIGIN,'Content-Type':'application/json','Content-Length':str(len(body))};handler.rfile=io.BytesIO(body)
        answers=[];handler.send=lambda status,body,**kw:answers.append((status,json.loads(body)))
        with patch.object(service,'site_profile',return_value={'customer_id':'fixture'}):handler.do_POST()
        self.assertEqual(answers,[(403,{'error':'owner_only_setting'})])

    def test_aggregate_action_only_accepts_empty_arguments(self):
        registry=service.Registry.__new__(service.Registry)
        with patch.object(service,'gateway',return_value={'schema':'alisa-model-usage/v1','attempts':4,'requests':2,'average':2}) as gateway:
            self.assertEqual(registry.admin('model_usage',{},'fixture')['average'],2)
            with self.assertRaises(service.Fault):registry.admin('model_usage',{'tenant':'other'},'fixture')
            self.assertEqual(gateway.call_count,1)

if __name__=='__main__':unittest.main()
