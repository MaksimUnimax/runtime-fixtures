import tempfile
from pathlib import Path
from service import Delivery, validate_settings
from eta import baseline, pending, label

class Cipher:
    def encrypt(self, value): return value
    def decrypt(self, value): return value

timebox = [1000.]
status = ['QUEUED']
utterances = []
with tempfile.TemporaryDirectory() as path:
    def peek(payload): return {'state': status[0], 'text': 'Итог: двадцать пять.' if status[0] == 'READY' else ''}
    delivery = Delivery(path, Cipher(), clock=lambda: timebox[0], auth=lambda tenant, token: True, peek=peek)
    delivery.state.update(connected=True, selected={'id': 'station1'}, binding={'tenant':'user1','application':'app1'})
    delivery.save()
    delivery.speak = lambda text, gen, guard=None, mode='text': utterances.append((timebox[0], text, mode))
    result = delivery.ingress({'op':'after','tenant':'user1','application':'app1','token_hash':'token1',
        'conversation':'conversation01','result':{'state':'QUEUED','job_id':'job1','text':'Расчёт'}})
    assert result['text'] == '60 секунд.' and result['end_session'] is True, result
    for now in (1010,1020,1030,1040,1050,1060,1070):
        timebox[0] = now; delivery.tick()
    phrases = [x[1] for x in utterances]
    assert len(phrases) == 7, utterances
    assert all('осталось' in x and 'около' in x for x in phrases), utterances
    assert '50 секунд' in phrases[0] and '40 секунд' in phrases[1], phrases
    assert 'около 0 секунд' not in phrases[-1], phrases
    timebox[0] = 1071; status[0] = 'READY'; delivery.tick()
    assert utterances[-1][0] == 1071 and utterances[-1][2] == 'skill', utterances
    assert delivery.state['eta_history'] == [71], delivery.state['eta_history']
    assert delivery.state['job']['delivery'] == 'accepted_waiting_skill'
    again = Delivery(path, Cipher(), clock=lambda: timebox[0], auth=lambda tenant, token: True, peek=peek)
    assert again.state['eta_history'] == [71], again.state['eta_history']
    assert validate_settings(again.state['settings'])
    assert pending('Ждите {remaining}.', {'created':1000, 'eta_base':60, 'eta_until':1090}, 1080) == 'Ждите около 10 секунд.'
    print('PASS: initial ETA, seven 10s updates with remaining time, READY immediately, persisted observations')

# The spoken acknowledgement contains only the current estimate.
with tempfile.TemporaryDirectory() as path:
    delivery = Delivery(path, Cipher(), clock=lambda: 1000., auth=lambda tenant, token: True)
    delivery.state.update(connected=True, selected={'id':'station1'}, binding={'tenant':'user1','application':'app1'}, eta_history=[10,20,30])
    delivery.save()
    result = delivery.ingress({'op':'after','tenant':'user1','application':'app1','token_hash':'token1',
        'conversation':'conversation02','result':{'state':'QUEUED','job_id':'job2','text':'Расчёт'}})
    assert result == {'text':'30 секунд.','end_session':True}, result
    assert delivery.state['job']['eta_base'] == 30
    print('PASS: short acknowledgement with a thirty-second estimate')
