"""Grant platform traverse-only on the existing private runtime parent."""
import ctypes,ctypes.util,os,pathlib,pwd,stat
P=pathlib.Path('/run/alice-market');before=P.lstat()
assert os.geteuid()==0 and stat.S_ISDIR(before.st_mode) and before.st_uid==pwd.getpwnam('alice-market').pw_uid and not before.st_mode&0o2022
uid=pwd.getpwnam('alisa-platform-stage').pw_uid
lib=ctypes.CDLL(ctypes.util.find_library('acl'),use_errno=True)
lib.acl_get_file.argtypes=[ctypes.c_char_p,ctypes.c_int];lib.acl_get_file.restype=ctypes.c_void_p
lib.acl_to_text.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_ssize_t)];lib.acl_to_text.restype=ctypes.c_void_p
lib.acl_from_text.argtypes=[ctypes.c_char_p];lib.acl_from_text.restype=ctypes.c_void_p
lib.acl_valid.argtypes=[ctypes.c_void_p];lib.acl_set_file.argtypes=[ctypes.c_char_p,ctypes.c_int,ctypes.c_void_p];lib.acl_free.argtypes=[ctypes.c_void_p]
old=lib.acl_get_file(os.fsencode(P),0x8000);assert old
text=lib.acl_to_text(old,None);assert text
try:lines=ctypes.string_at(text).decode().splitlines()
finally:lib.acl_free(text);lib.acl_free(old)
names={str(uid),'alisa-platform-stage'};found=False
for line in lines:
 parts=line.split(':')
 if len(parts)>=3 and parts[0]=='user' and parts[1] in names:
  assert parts[2].split()[0]=='--x','Unknown existing ACL must be preserved';found=True
if not found:lines.append('user:'+str(uid)+':--x')
if not any(l.startswith('mask:') for l in lines):lines.append('mask::r-x')
new=lib.acl_from_text(('\n'.join(lines)+'\n').encode());assert new
try:assert lib.acl_valid(new)==0 and lib.acl_set_file(os.fsencode(P),0x8000,new)==0
finally:lib.acl_free(new)
after=P.lstat();assert (before.st_dev,before.st_ino,before.st_uid,before.st_gid)==(after.st_dev,after.st_ino,after.st_uid,after.st_gid) and not after.st_mode&0o022
