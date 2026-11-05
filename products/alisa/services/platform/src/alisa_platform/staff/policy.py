"""Staff authority belongs to one product; identity login alone grants nothing."""
import math
import re
import uuid

PRODUCT='alisa_market'
ADMIN_PERMISSIONS=frozenset({'users.read','users.block','users.unblock','leads.read','sessions.revoke','audit.read','access.grant'})
OWNER_PERMISSIONS=ADMIN_PERMISSIONS|{'staff.manage'}
REASONS=frozenset({'SUPPORT_REQUEST','SECURITY_REVIEW','OWNER_ASSIGNMENT','STAFF_REVOCATION','STAFF_READ','BOOTSTRAP'})

def permissions(value):
    if not isinstance(value,list) or len(value)>len(ADMIN_PERMISSIONS):raise ValueError('Invalid permission set')
    if any(not isinstance(v,str) or v not in ADMIN_PERMISSIONS for v in value) or len(set(value))!=len(value):raise ValueError('Invalid permission set')
    return sorted(value)

def reason(value):
    if not isinstance(value,str) or value not in REASONS:raise ValueError('A predefined reason is required')
    return value

def identifier(value):
    if not isinstance(value,str):raise ValueError('UUID required')
    return str(uuid.UUID(value))

def positive_revision(value):
    if type(value) is not int or not 1<=value<=2147483647:raise ValueError('Positive integer revision required')
    return value

def session_allowed(member,session,*,issuer,client,now,permission):
    # Server-provided membership and session snapshots, never browser role headers.
    try:
        if member['product_id']!=PRODUCT or session['product_id']!=PRODUCT:return False
        if member['issuer']!=issuer or member['client_id']!=client:return False
        if member['active'] is not True or session['revoked'] is not False:return False
        if positive_revision(member['revision'])!=positive_revision(session['revision']):return False
        if member['role'] not in {'OWNER','ADMIN'}:return False
        if type(now) not in {int,float} or not math.isfinite(now):return False
        expiry=session['expires_at'];factor=session['mfa_at'];created=session['created_at']
        if any(type(v) not in {int,float} or not math.isfinite(v) for v in [expiry,factor,created]):return False
        if expiry<=now or created>now+5 or expiry-created>3600 or now-created>3600:return False
        if factor>now+5 or now-factor>300:return False
        if session['mfa_type'] not in {'totp','recovery_codes'}:return False
        allowed=OWNER_PERMISSIONS if member['role']=='OWNER' else set(permissions(member['permissions']))
        return permission in OWNER_PERMISSIONS and permission in allowed
    except (KeyError,ValueError,TypeError):return False

def audit_projection(value):
    if not isinstance(value,dict):raise ValueError('Safe projection required')
    result={}
    for key,item in value.items():
        if key in {'customer_id','tenant_id','staff_id','session_id'}:result[key]=identifier(item)
        elif key=='active' and type(item) is bool:result[key]=item
        elif key=='revision':result[key]=positive_revision(item)
        elif key=='role' and isinstance(item,str) and item in {'OWNER','ADMIN'}:result[key]=item
        elif key=='permissions':result[key]=permissions(item)
        elif key=='subject_fingerprint' and isinstance(item,str) and re.fullmatch(r'[0-9a-f]{64}',item):result[key]=item
        elif key=='count' and type(item) is int and 0<=item<=1000:result[key]=item
        else:raise ValueError('Unsafe audit field')
    return result
