"""Private CA and loopback HTTPS proxy for an isolated browser qualification."""
import datetime
import json
import re
from urllib.parse import urlsplit
import http.client
import http.server
import ipaddress
from pathlib import Path
import ssl
import threading
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.x509.oid import NameOID

def certificates(root):
    now=datetime.datetime.now(datetime.timezone.utc)
    ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Alisa disposable CI root')])
    ca=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(ca_key,hashes.SHA256())
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    certificate=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).sign(ca_key,hashes.SHA256())
    ca_file=root/'own-root.pem';ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM));ca_file.chmod(0o644)
    cert_file=root/'own-server.pem';cert_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM)+ca.public_bytes(serialization.Encoding.PEM))
    key_file=root/'own-server-key.pem';key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));key_file.chmod(0o600)
    return ca_file,cert_file,key_file

class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_GET(self):self.forward()
    def do_POST(self):self.forward()
    def forward(self):
        size=int(self.headers.get('Content-Length','0'))
        if size>32768:self.send_error(413);return
        headers={k:v for k,v in self.headers.items() if k.lower() not in {'connection','transfer-encoding','content-length'}}
        headers['X-Forwarded-Proto']='https'
        connection=http.client.HTTPConnection('127.0.0.1',self.server.backend,timeout=8)
        try:
            body=self.rfile.read(size) if size else None
            observer=getattr(self.server,'request_observer',None)
            if observer:observer(self.path,headers,body)
            hook=getattr(self.server,'request_hook',None)
            if hook:body=hook(self.path,body)
            if body is not None:headers['Content-Length']=str(len(body))
            path_hook=getattr(self.server,'path_hook',None)
            forwarded_path=path_hook(self.path) if path_hook else self.path
            connection.request(self.command,forwarded_path,body,headers)
            response=connection.getresponse();body=response.read()
            hook=getattr(self.server,'response_hook',None)
            if hook:body=hook(self.path,response.status,body)
            status=response.status
            hook=getattr(self.server,'result_hook',None)
            if hook:status,body=hook(self.path,status,body)
            origin=self.headers.get('Origin')
            kind='absent' if origin is None else 'null' if origin=='null' else 'loopback' if urlsplit(origin).hostname in {'127.0.0.1','localhost'} else 'other'
            trace={'backend':self.server.backend,'method':self.command,'path':urlsplit(self.path).path,'status':status,'origin_kind':kind}
            if getattr(response,'headers',{}).get('Content-Type','').startswith('application/json'):
                try:code=json.loads(body).get('code')
                except (ValueError,AttributeError):code=None
                if isinstance(code,str) and re.fullmatch(r'[A-Z_]{1,64}',code):trace['code']=code
            self.server.safe_trace.append(trace)
            self.send_response(status)
            for key,value in response.getheaders():
                if key.lower() not in {'connection','transfer-encoding','content-length'}:self.send_header(key,value)
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        except OSError as exc:
            self.server.safe_trace.append({'backend':self.server.backend,'method':self.command,'path':urlsplit(self.path).path,'error_type':type(exc).__name__})
            # Browser cancellation must not print a traceback or reflect a URL.
            self.close_connection=True
        finally:connection.close()

def start_proxy(port,backend,cert,key):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Proxy);server.daemon_threads=True;server.backend=backend;server.safe_trace=[]
    context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key)
    server.socket=context.wrap_socket(server.socket,server_side=True)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server

def start_plain_proxy(port,backend):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Proxy)
    server.daemon_threads=True;server.backend=backend;server.safe_trace=[]
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server
