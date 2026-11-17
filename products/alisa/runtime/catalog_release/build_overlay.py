"""Add the opt-in release path to an already composed current core.

The package rules have one editable source in the platform. The native copy is
materialized here byte-for-byte, and is included in the native engine seal.
"""
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RULES=ROOT.parents[1]/'services/platform/src/alisa_platform/catalog/package_rules.py'


def native_sources(root):
 root=Path(root)
 if (root/'catalog_release').exists():raise ValueError('CATALOG_RELEASE_ALREADY_COMPOSED')
 source=(root/'runtime_port_service.py').read_text()
 anchor='    try:\n        gateway = Gateway('
 if source.count(anchor)!=1:raise ValueError('CATALOG_SERVICE_CONTEXT_MOVED')
 source=source.replace(anchor,
  "    from catalog_release.native import attach as attach_catalog_release\n"
  "    release_flag=os.environ.get('ALISA_CATALOG_RELEASE_ENABLED','0')\n"
  "    if release_flag not in {'0','1'}:raise Rejected('RUNTIME_PORT_CONFIG')\n"
  "    attach_catalog_release(port,release_flag=='1')\n"+anchor)
 result={'runtime_port_service.py':source,
  'catalog_release/__init__.py':(ROOT/'__init__.py').read_text(),
  'catalog_release/native.py':(ROOT/'native.py').read_text(),
  'catalog_release/rules.py':RULES.read_text()}
 for name,body in result.items():compile(body,name,'exec')
 return result
