import importlib.util, os
from unittest.mock import patch

os.environ.update(LAB_LOG_KEY='x'*40,LAB_OAUTH_CLIENT_SECRET='s'*40,LAB_TEST_PASSWORD='p'*20)
path='/opt/alisa-station/releases/station-auto-r6-session/alice_lab.py'
spec=importlib.util.spec_from_file_location('lab_session_test',path)
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
body={'version':'1.0','meta':{},'session':{'skill_id':lab.SKILL,'session_id':'test-session-01',
      'message_id':1,'user':{'access_token':'test-token'},'application':{'application_id':'test-device'}},
      'request':{'type':'SimpleUtterance','command':'сколько заказов','original_utterance':'сколько заказов'}}
with patch.object(lab,'auth_token',return_value='owner'),patch.object(lab.marketplace,'handles',return_value=True):
    with patch.object(lab.station_client,'handle_turn',return_value=('Задание принято.',True)):
        code,answer,view=lab.skill(body)
        assert code==200 and answer['response']['end_session'] is True, answer
    with patch.object(lab.station_client,'handle_turn',return_value=('Готово.',False)):
        code,answer,view=lab.skill(body)
        assert code==200 and answer['response']['end_session'] is False, answer
print('PASS lab webhook end_session follows structured station decision')