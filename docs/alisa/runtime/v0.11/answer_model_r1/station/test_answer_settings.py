import io,json,unittest
from unittest.mock import patch
from types import SimpleNamespace
import service

FIELDS={'request_planning_prompt':'Разбор\nшаблонов','answer_prompt':'Ответ по данным','answer_extra_instruction':''}
class AdminAnswerSettings(unittest.TestCase):
 def invoke(self,action,data,site=False):
  handler=service.AdminHandler.__new__(service.AdminHandler);body=json.dumps(dict(action=action,**data)).encode()
  handler.path=(service.SITE_BASE if site else service.BASE)+'api';handler.headers={'Host':'alisa.octoport.ru' if site else 'alisa-admin.octoport.ru','Origin':service.SITE_ORIGIN if site else service.ORIGIN,'Content-Type':'application/json','Content-Length':str(len(body))};handler.rfile=io.BytesIO(body)
  replies=[];handler.send=lambda status,body,**kw:replies.append((status,json.loads(body)))
  registry=service.Registry.__new__(service.Registry);handler.server=SimpleNamespace(delivery=registry)
  with patch.object(service,'site_profile',return_value={'customer_id':'fixture'}),patch.object(service,'staff_profile',return_value={'id':'owner'}):handler.do_POST()
  return replies[0]
 def test_owner_save_load_clear_and_stale_revision(self):
  saved={'revision':0,**FIELDS}
  def gateway(data):
   if data['op']=='answer_settings':return dict(saved)
   if data['revision']!=saved['revision']:return {'error':'ANSWER_SETTINGS_CHANGED_RELOAD'}
   saved.update({k:data[k]for k in FIELDS});saved['revision']+=1;return dict(saved)
  with patch.object(service,'gateway',side_effect=gateway):
   self.assertEqual(self.invoke('answer_settings',{}),(200,saved))
   payload={'revision':0,**FIELDS,'answer_extra_instruction':'Тест\nинструкции'}
   self.assertEqual(self.invoke('answer_settings_save',payload)[0],200)
   self.assertEqual(self.invoke('answer_settings',{})[1]['answer_extra_instruction'],'Тест\nинструкции')
   self.assertEqual(self.invoke('answer_settings_save',payload),(409,{'error':'settings_changed_reload'}))
   self.assertEqual(self.invoke('answer_settings_save',dict(payload,revision=1,answer_extra_instruction=''))[1]['answer_extra_instruction'],'')
 def test_customer_cannot_read_or_save_prompts(self):
  with patch.object(service,'gateway')as gateway:
   for action in ('answer_settings','answer_settings_save'):
    self.assertEqual(self.invoke(action,{},site=True),(403,{'error':'owner_only_setting'}))
   gateway.assert_not_called()
 def test_partial_payload_cannot_overwrite_other_fields(self):
  with patch.object(service,'gateway')as gateway:
   self.assertEqual(self.invoke('answer_settings_save',{'revision':0,'answer_extra_instruction':'x'})[0],403)
   gateway.assert_not_called()
if __name__=='__main__':unittest.main()
