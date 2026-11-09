import csv,unittest
from unittest.mock import patch
from csv_transport import decode_csv,CSVDecodeError
import read_surface

class CSVTransport(unittest.TestCase):
    def test_semicolon_decimal_commas_and_quoted_fields(self):
        raw='SKU;Расход, руб.;Название\r\n001;12,34;"Товар; с точкой и запятой"\r\n002;7,89;"Товар, второй"\r\n'.encode()
        rows=decode_csv(raw)['rows']
        self.assertEqual(len(rows),2);self.assertEqual(rows[0]['SKU'],'001')
        self.assertEqual(rows[0]['Расход, руб.'],'12,34')
        self.assertEqual(rows[1]['Название'],'Товар, второй')
        self.assertTrue(all(type(key)is str for row in rows for key in row))
        self.assertEqual(read_surface.sanitize({'rows':rows})['rows'],rows)
    def test_comma_and_quoted_newline(self):
        self.assertEqual(decode_csv(b'id,name\n1,"first\nsecond"\n')['rows'],[{'id':'1','name':'first\nsecond'}])
    def test_tab_and_bom(self):
        self.assertEqual(decode_csv('\ufeffid\tcost\n01\t2.50\n'.encode())['rows'],[{'id':'01','cost':'2.50'}])
    def test_single_column(self):
        self.assertEqual(decode_csv(b'id\n001\n002\n')['rows'],[{'id':'001'},{'id':'002'}])
    def test_header_only_is_empty_table_not_a_fabricated_number(self):
        self.assertEqual(decode_csv(b'id,cost\n')['rows'],[])
    def test_duplicate_or_missing_header_rejected(self):
        for raw in [b'id,id\n1,2\n',b'id,\n1,2\n']:
            with self.assertRaises(CSVDecodeError):decode_csv(raw)
    def test_inconsistent_rows_never_create_none_key_or_drop_cells(self):
        with self.assertRaises(CSVDecodeError)as error:decode_csv(b'id,cost\n1,2,3\n',delimiter=',')
        self.assertEqual(error.exception.code,'READ_CSV_SHAPE')
    def test_encoding_and_empty_body_have_known_errors(self):
        for raw in [b'',b'\xff']:
            with self.assertRaises(CSVDecodeError):decode_csv(raw)
    def test_sniffer_cannot_trim_spaces(self):
        self.assertEqual(decode_csv(b'id, name\n1,  leading\n')['rows'],[{'id':'1',' name':'  leading'}])
    def test_sniffer_cannot_strip_literal_apostrophes(self):
        self.assertEqual(decode_csv(b"id;name\n1;'literal'\n")['rows'],[{'id':'1','name':"'literal'"}])
    def test_ambiguous_separator_rejected_without_guessing(self):
        raw=b'id;cost,rub;name\n1;12,34;alpha\n2;56,78;beta\n'
        with self.assertRaises(CSVDecodeError):decode_csv(raw)
        self.assertEqual(decode_csv(raw,delimiter=';')['rows'][0]['cost,rub'],'12,34')
    def test_late_quoted_field_after_long_plain_prefix(self):
        raw=b'id,name\n'+b'1,ordinary\n'*6000+b'2,"hello ""world"""\n'
        self.assertEqual(decode_csv(raw)['rows'][-1]['name'],'hello "world"')
    def test_sensitive_header_redaction_is_preserved(self):
        rows=read_surface.sanitize(decode_csv(b'id;email;access_token\n1;a@example.invalid;synthetic\n'))['rows']
        self.assertEqual(rows[0]['email'],'[REDACTED]');self.assertEqual(rows[0]['access_token'],'[REDACTED]')
    def test_received_malformed_csv_is_known_failure_without_retry(self):
        import time
        from dataclasses import asdict
        from test_runtime import OZ
        from http_transport import HTTPTransport,SCALARS
        from engine import CallError
        from request_recovery import retry_due
        store=asdict(OZ)
        transport=HTTPTransport('/unused',{store['id']:'fixture'},{},enabled=True,read_surface_policy=lambda:{'enabled':True,'pin':read_surface.PIN})
        for profile in SCALARS.auth:transport._tokens[transport._cache_key(store,profile)]=('fixture',time.time()+3600)
        request=read_surface.request_for(store,'performance_campaign_product_csv',{'dateFrom':'2026-11-08','dateTo':'2026-11-08'})
        with patch.object(transport,'_credential',return_value='{}'),patch('http_transport.read_response',return_value=(b'id,cost\n1,2,3\n',200)):
            with self.assertRaises(CallError)as raised:transport.execute(request,store)
        self.assertTrue(raised.exception.code.startswith('READ_CSV_'))
        self.assertEqual(raised.exception.status,200);self.assertFalse(raised.exception.unknown)
        self.assertIsNone(retry_due(None,None,request,raised.exception,True))

if __name__=='__main__':unittest.main()
