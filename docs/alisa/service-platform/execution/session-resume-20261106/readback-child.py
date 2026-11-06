import sys,os,json,pathlib,hashlib
sys.dont_write_bytecode=True
import django;django.setup()
from django.conf import settings
from django.urls import resolve,reverse
from django.template.loader import get_template
from octoport_identity.protocol.mfa_forms import LoginCodeForm,ConfirmCodeForm,FreshCodeInput
from octoport_identity.protocol.views import brand_context
from django.test import RequestFactory
from django.contrib.auth.models import AnonymousUser
from types import SimpleNamespace
root=pathlib.Path('/opt/alisa-platform/stage/identity-current').resolve()
mapping=settings.MFA_FORMS
assert mapping['authenticate']=='octoport_identity.protocol.mfa_forms.LoginCodeForm'
assert mapping['reauthenticate']=='octoport_identity.protocol.mfa_forms.ConfirmCodeForm'
assert 'synthetic-invalid-value' not in FreshCodeInput().render('code','synthetic-invalid-value')
q=RequestFactory().get(reverse('mfa_reauthenticate'));q.session={};q.user=AnonymousUser();q.resolver_match=resolve(q.path)
ctx=brand_context(q);assert ctx['admin_home_url']=='https://alisa-admin.octoport.ru/admin'
assert ctx['mfa_page']
checks={'native_forms_loaded':True,'rejected_input_not_repopulated':True,'fixed_admin_dashboard_link':True}
hashes={}
for name in ['mfa/reauthenticate.html','mfa/recovery_codes/index.html','allauth/layouts/base.html']:
 t=get_template(name);p=pathlib.Path(t.origin.name);assert p.resolve().is_relative_to(root)
 text=p.read_text();hashes[name]=hashlib.sha256(p.read_bytes()).hexdigest()
 if name=='mfa/reauthenticate.html':
  assert 'admin_home_url' in text and 'Открыть админку' in text
  assert '30 секунд' in text
assert resolve(reverse('mfa_activate_totp')).func.view_class.__module__=='octoport_identity.protocol.mfa'
checks['single_challenge_activation_preserved']=True
assert settings.IDENTITY_ISSUER=='https://id.octoport.ru'
checks['canonical_issuer']=True
print(json.dumps({'checks':checks,'template_hashes':hashes,'mfa_forms':mapping}))
