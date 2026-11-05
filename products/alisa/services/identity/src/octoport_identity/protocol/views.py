import uuid
from django.http import JsonResponse
from django.http import HttpResponse
from django.conf import settings
from octoport_identity.accounts.models import IdentityMail

def mail_status(request):
    if request.method!='GET':return JsonResponse({'code':'METHOD_NOT_ALLOWED'},status=405)
    try:mail_id=uuid.UUID(request.session.get('identity_mail_id',''))
    except (ValueError,TypeError,AttributeError):return JsonResponse({'state':'UNKNOWN'},status=404)
    row=IdentityMail.objects.filter(pk=mail_id).first()
    state='UNKNOWN' if not row else 'DELIVERED' if row.sent_at else 'DELAYED' if row.error_code else 'QUEUED'
    response=JsonResponse({'state':state});response['Cache-Control']='no-store';return response

def brand_context(request):return {'alisa_product_origin':settings.IDENTITY_PRODUCT_ORIGIN}

def mail_ui(request):
    script="""let attempts=0;async function check(){try{const r=await fetch('/identity/mail-status',{cache:'no-store'});if(r.ok){const d=await r.json();const el=document.getElementById('mail-status');const text={QUEUED:'Готовим письмо с кодом. Проверьте тестовую почту.',DELIVERED:'Письмо с кодом отправлено.',DELAYED:'Пока не удалось отправить письмо. Повторим отправку; можно запросить новый код.'};el.textContent=text[d.state]||'';if(d.state==='DELIVERED')return;}}catch{}if(++attempts<60)setTimeout(check,2000);}check();"""
    return HttpResponse(script,content_type='application/javascript')
