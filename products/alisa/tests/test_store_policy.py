import sys
import unittest
from pathlib import Path
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'services/platform/src'))
from alisa_platform.stores.policy import validate


class StoreInput(unittest.TestCase):
    def create(self):
        return {'action': 'create', 'command_id': str(uuid.uuid4()), 'provider': 'OZON',
                'name': 'Основной', 'voice_alias': '', 'credential': {'client_id': '123', 'api_key': 'synthetic-key-123456'}}

    def test_no_browser_scope_or_arbitrary_provider_endpoint(self):
        for field in ['tenant_id', 'customer_id', 'product_id', 'url', 'socket', 'verified_identity']:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate({**self.create(), field: 'other'})

    def test_secret_shape_and_header_injection(self):
        for value in ['', 'short', 'a'*8193, 'synthetic-key\r\nHeader:other', ' api-key-secret ']:
            command=self.create();command['credential']['api_key']=value
            with self.subTest(length=len(value)), self.assertRaises(ValueError):validate(command)

    def test_explicit_types_for_revision_and_uuid(self):
        for value in [True, 1.0, '1', 0, -1]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate({'action': 'disable', 'command_id': str(uuid.uuid4()), 'store_id': str(uuid.uuid4()), 'expected_revision': value})

    def test_names_are_not_provider_identity(self):
        a=self.create();a['name']='Одинаковое имя';self.assertEqual(validate(a)['name'],'Одинаковое имя')
        for value in ['', 'a'*81, 'name\nother']:
            with self.subTest(value=value), self.assertRaises(ValueError):validate({**a,'name':value})

    def test_seller_performance_and_wb_credential_shapes_are_separate(self):
        a=self.create();a['provider']='WB';a['credential']={'token':'synthetic-wb-token'};validate(a)
        a['credential']={'client_id':'123','api_key':'synthetic-key-123456'}
        with self.assertRaises(ValueError):validate(a)


if __name__ == '__main__':unittest.main()
