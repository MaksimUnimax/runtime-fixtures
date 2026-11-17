"""Bootstrap the existing product service in the same process and listeners.

All added code lives under this package. No root-level core file changes, so
the existing RuntimePort catalog_bundle_hash and admitted guards remain valid.
"""
from pathlib import Path
import os
import runpy


def bootstrap():
 import runtime_port_service
 from semantics import Rejected
 from .native import attach
 root=Path(__file__).resolve().parents[1]
 if Path(runtime_port_service.__file__).resolve()!=root/'runtime_port_service.py':
  raise Rejected('RUNTIME_PORT_CONFIG')
 if getattr(runtime_port_service,'_catalog_release_bootstrap',False):raise Rejected('RUNTIME_PORT_CONFIG')
 flag=os.environ.get('ALISA_CATALOG_RELEASE_ENABLED','0')
 if flag not in {'0','1'}:raise Rejected('RUNTIME_PORT_CONFIG')
 original=runtime_port_service.attach
 def connected(engine,configuration,credentials_directory):
  gateway=original(engine,configuration,credentials_directory)
  if gateway is None:return None
  try:
   attach(gateway.port,flag=='1');return gateway
  except BaseException:
   runtime_port_service.close(gateway)
   if engine.execution_policy is gateway.port:engine.execution_policy=None
   raise
 runtime_port_service.attach=connected
 runtime_port_service._catalog_release_bootstrap=True
 return root


def main():
 root=bootstrap()
 runpy.run_path(str(root/'runtime.py'),run_name='__main__')


if __name__=='__main__':main()
