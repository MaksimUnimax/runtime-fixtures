"""Standard Fernet protection for identity session, cache and queued mail data."""
import hashlib
import json
from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from django.conf import settings
from django.core.cache.backends.db import DatabaseCache
from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.serializers.json import DjangoJSONEncoder

def protector():
    return MultiFernet([Fernet(k.encode()) for k in settings.IDENTITY_DATA_KEYS])

def seal(value):
    return protector().encrypt(json.dumps(value,cls=DjangoJSONEncoder,separators=(',',':')).encode()).decode()

def open_sealed(value):
    return json.loads(protector().decrypt(value.encode()))

class SessionSerializer:
    def dumps(self,obj):return seal(obj).encode()
    def loads(self,data):return open_sealed(data.decode())

def cache_key(key,key_prefix,version):
    return hashlib.sha256((str(key_prefix)+':'+str(version)+':'+key).encode()).hexdigest()

class PrivateDatabaseCache(DatabaseCache):
    def _base_set(self,mode,key,value,timeout=DEFAULT_TIMEOUT):
        if mode!='touch':
            from .staff import bind_code
            value=seal(bind_code(value))
        return super()._base_set(mode,key,value,timeout)
    def get_many(self,keys,version=None):
        result={}
        for key,value in super().get_many(keys,version).items():
            try:result[key]=open_sealed(value)
            except (InvalidToken,ValueError,TypeError,AttributeError):self.delete(key,version)
        return result
