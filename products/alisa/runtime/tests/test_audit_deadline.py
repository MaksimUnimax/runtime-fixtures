"""Local socket fixtures only: no marketplace requests or credentials."""
import contextlib
import socket
import ssl
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import shared_http as http

@contextlib.contextmanager
def server(handler):
    listener=socket.socket()
    listener.bind(('127.0.0.1',0));listener.listen(8);listener.settimeout(.1)
    stopped=threading.Event();children=[]
    def accept():
        while not stopped.is_set():
            try:conn,_=listener.accept()
            except socket.timeout:continue
            except OSError:break
            def run(conn=conn):
                try:
                    with conn:handler(conn)
                except (OSError,ssl.SSLError):pass
            t=threading.Thread(target=run,daemon=True);children.append(t);t.start()
    t=threading.Thread(target=accept,daemon=True);t.start()
    try:yield listener.getsockname()[1]
    finally:
        stopped.set();listener.close();t.join(1)
        for child in children:child.join(1)

def request(port, scheme='http'):
    return urllib.request.Request(scheme+'://127.0.0.1:'+str(port)+'/test',data=b'{}',method='POST')

class DeadlineTests(unittest.TestCase):
    def timed(self, req, budget=.15, **kw):
        start=time.monotonic()
        with self.assertRaises((TimeoutError,urllib.error.URLError)):
            http.read_response(req,timeout=budget,**kw)
        self.assertLess(time.monotonic()-start,budget+.25)
    def test_slow_headers_total_deadline(self):
        def serve(conn):
            conn.recv(4096)
            for _ in range(50):
                conn.sendall(b'H');time.sleep(.03)
        with server(serve) as port:self.timed(request(port))
    def test_trickled_body_total_deadline(self):
        def serve(conn):
            conn.recv(4096);conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 80\r\n\r\n')
            for _ in range(80):
                conn.sendall(b'x');time.sleep(.03)
        with server(serve) as port:self.timed(request(port))
    def test_tls_handshake_total_deadline(self):
        def serve(conn):conn.recv(4096);time.sleep(.5)
        with server(serve) as port:self.timed(request(port,'https'))
    def test_deadline_precedes_timeout(self):
        def serve(conn):conn.recv(4096);time.sleep(.4)
        with server(serve) as port:
            start=time.monotonic()
            with self.assertRaises((TimeoutError,urllib.error.URLError)):
                http.read_response(request(port),timeout=5,deadline=start+.12)
            self.assertLess(time.monotonic()-start,.37)
    def test_dns_late_return_never_dispatches_and_slots_are_bounded(self):
        release=threading.Event();entered=[];sent=[]
        original=socket.getaddrinfo
        def resolve(*args,**kw):
            entered.append(1);release.wait(2)
            return original(*args,**kw)
        def serve(conn):sent.append(conn.recv(4096))
        with server(serve) as port:
            with patch('shared_http.socket.getaddrinfo',resolve):
                try:
                    for _ in range(http._MAX_IO+3):self.timed(request(port),budget=.05)
                    self.assertEqual(len(entered),http._MAX_IO)
                    self.assertLessEqual(sum(t.name=='alisa-http-io' for t in threading.enumerate()),http._MAX_IO)
                finally:release.set()
                until=time.monotonic()+1
                while any(t.name=='alisa-http-io' for t in threading.enumerate()) and time.monotonic()<until:time.sleep(.01)
            self.assertEqual(sent,[])
        # All slots must become usable again after late DNS workers exit.
        def good(conn):conn.recv(4096);conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
        with server(good) as port:self.assertEqual(http.read_response(request(port),timeout=1),(b'ok',200))
    def test_size_bound_redirect_and_http_error_preserved(self):
        def sized(conn):conn.recv(4096);conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 20\r\n\r\n'+b'x'*20)
        with server(sized) as port:self.assertEqual(http.read_response(request(port),limit=3,timeout=1),(b'xxxx',200))
        for status,headers in [(302,b'Location: http://127.0.0.1:1/no\r\n'),(429,b'Retry-After: 7\r\n')]:
            def denied(conn):
                conn.recv(4096);conn.sendall(('HTTP/1.1 '+str(status)+' Error\r\n').encode()+headers+b'Content-Length: 0\r\n\r\n')
            with server(denied) as port:
                with self.assertRaises(urllib.error.HTTPError) as cm:http.read_response(request(port),timeout=1)
                self.assertEqual(cm.exception.code,status)
                if status==429:self.assertEqual(cm.exception.headers['Retry-After'],'7')
    def test_completed_requests_release_slots(self):
        def good(conn):conn.recv(4096);conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
        with server(good) as port:
            for _ in range(12):self.assertEqual(http.read_response(request(port),timeout=1),(b'ok',200))
    def test_cancel_before_socket_publication_closes_socket(self):
        budget=http._Budget(time.monotonic()+1,1);budget.cancel()
        sock=socket.socket()
        with self.assertRaises(TimeoutError):budget.publish(sock)
        self.assertEqual(sock.fileno(),-1)
