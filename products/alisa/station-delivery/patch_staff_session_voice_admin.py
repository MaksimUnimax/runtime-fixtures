from pathlib import Path
import os,subprocess
root=Path('/opt/alisa-platform/stage/releases')
platform=root/'alisa-staff-session-r1-20261108';admin=root/'alisa-admin-session-r1-20261108'
assert not platform.exists() and not admin.exists()
subprocess.run(['cp','-al','/opt/alisa-platform/stage/site-current/.',str(platform)],check=True)
subprocess.run(['cp','-al','/opt/alisa-platform/stage/admin-current/.',str(admin)],check=True)
def patch(p,old,new):
 s=p.read_text();assert s.count(old)==1,(p,old,s.count(old))
 t=p.with_name(p.name+'.new');t.write_text(s.replace(old,new));os.chmod(t,p.stat().st_mode);os.replace(t,p)
staff=platform/'services/platform/src/alisa_platform/staff'
patch(staff/'views.py','encrypted_payload=payload, expires_at=now + timedelta(hours=1))','encrypted_payload=payload, expires_at=now + timedelta(days=30))')
patch(staff/'policy.py','expiry-created>3600 or now-created>3600','expiry-created>30*86400 or now-created>30*86400')
patch(staff/'policy.py','if factor>now+5 or now-factor>300:return False','if factor>now+5 or factor<created-300:return False')
patch(staff/'views.py',"        if not row or row.consumed_at or row.expires_at <= timezone.now():\n            return reply({'code': 'INVALID_FLOW'}, 400)\n        payload = row.encrypted_payload\n        row.consumed_at = timezone.now()\n        row.encrypted_payload = ''\n        row.save(update_fields=['consumed_at', 'encrypted_payload'])\n    return reply({'flow_id': str(row.pk), 'encrypted_payload': payload})","        if (not row or row.expires_at <= timezone.now() or not row.encrypted_payload\n                or StaffSession.objects.filter(flow=row).exists()):\n            return reply({'code': 'INVALID_FLOW'}, 400)\n        payload = row.encrypted_payload\n        if not row.consumed_at:\n            row.consumed_at = timezone.now()\n            row.save(update_fields=['consumed_at'])\n        # A callback interrupted before token exchange can resume the same\n        # browser-bound flow; its payload is erased when the session is created.\n    return reply({'flow_id': str(row.pk), 'encrypted_payload': payload})")
patch(staff/'views.py',"        row = StaffSession.objects.create(product_id=PRODUCT, token_hash=data['session_hash'], member=member,\n            flow=flow, revision=member.revision, mfa_verified_at=factor, mfa_type=data['mfa_type'],\n            encrypted_payload=payload, expires_at=now + timedelta(days=30))\n        audit(member, 'staff.login', row.pk, 'SECURITY_REVIEW', 'APPLIED', after={'session_id': str(row.pk)})","        row = StaffSession.objects.create(product_id=PRODUCT, token_hash=data['session_hash'], member=member,\n            flow=flow, revision=member.revision, mfa_verified_at=factor, mfa_type=data['mfa_type'],\n            encrypted_payload=payload, expires_at=now + timedelta(days=30))\n        flow.encrypted_payload = ''\n        flow.save(update_fields=['encrypted_payload'])\n        audit(member, 'staff.login', row.pk, 'SECURITY_REVIEW', 'APPLIED', after={'session_id': str(row.pk)})")
server=admin/'ui/admin/apps/admin/.next/server'
count=0
for p in server.rglob('*.js'):
 s=p.read_text()
 if 's(j,x,3600)' in s:patch(p,'s(j,x,3600)','s(j,x,2592000)');count+=1
assert count==5,count
p=server/'app/admin/page.js'
old='(0,d.jsx)("nav",{"aria-label":"Разделы",children:b.map(([a,b])=>(0,d.jsx)("button",{disabled:n||!!w,onClick:()=>{h(""),f(a)},children:b},a))})'
new='(0,d.jsxs)("nav",{"aria-label":"Разделы",children:[b.map(([a,b])=>(0,d.jsx)("button",{disabled:n||!!w,onClick:()=>{h(""),f(a)},children:b},a)),"OWNER"===a.role&&(0,d.jsx)("a",{href:"/admin/station/",children:"Голосовые ответы"},"voice-settings")]})'
patch(p,old,new)
p=next((admin/'ui/admin/apps/admin/.next/static/chunks/app/admin').glob('page-*.js'))
old='(0,i.jsx)("nav",{"aria-label":"Разделы",children:s.map(([e,s])=>(0,i.jsx)("button",{disabled:m||!!v,onClick:()=>{l(""),a(e)},children:s},e))})'
new='(0,i.jsxs)("nav",{"aria-label":"Разделы",children:[s.map(([e,s])=>(0,i.jsx)("button",{disabled:m||!!v,onClick:()=>{l(""),a(e)},children:s},e)),"OWNER"===e.role&&(0,i.jsx)("a",{href:"/admin/station/",children:"Голосовые ответы"},"voice-settings")]})'
patch(p,old,new)
print('PATCHED',platform,admin,'cookie_modules',count)