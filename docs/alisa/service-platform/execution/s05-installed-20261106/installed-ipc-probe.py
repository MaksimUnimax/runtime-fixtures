"""Actual peer/permission checks with an invalid body; never dispatch HTTP."""
import json,os,socket,struct
result={'scope':'INSTALLED_UNIX_PEER_NEGATIVE_PROBE_NO_PROVIDER_CALL','uid':os.geteuid(),'cases':[],'external_provider_calls':0}
def check(n,v):
 result['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as peer:
 peer.settimeout(3);peer.connect('/run/alice-market/store-check.sock')
 _,uid,gid=struct.unpack('3i',peer.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12));check('actual_runtime_server_identity',uid==996 and gid==982)
 try:peer.sendall(b'{}\n');raw=peer.recv(32768)
 except (ConnectionResetError,BrokenPipeError):raw=b''
 if os.geteuid()==993:
  body=json.loads(raw);check('trusted_platform_receives_bounded_protocol_error',body=={'schema_version':'rt_check_v1','pins':{},'result':{'code':'CHECK_UNAVAILABLE'}})
  check('old_report_gateway_access_denied',not os.access('/run/alice-market/gateway.sock',os.W_OK))
  try:os.listdir('/run/alice-market');listed=True
  except PermissionError:listed=False
  check('runtime_parent_is_traverse_only',not listed)
 else:check('untrusted_root_peer_closed_before_body_processing',os.geteuid()==0 and raw==b'')
result['status']='PASS';print(json.dumps(result))
