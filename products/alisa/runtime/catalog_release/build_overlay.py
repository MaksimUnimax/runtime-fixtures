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
 # Root-level .py files are part of the existing RuntimePort bundle hash.
 # Keep them byte-identical so already admitted guards remain valid.
 if not(root/'runtime_port_service.py').is_file()or not(root/'runtime.py').is_file():
  raise ValueError('CATALOG_SERVICE_CONTEXT_MOVED')
 result={'catalog_release/__init__.py':(ROOT/'__init__.py').read_text(),
  'catalog_release/entrypoint.py':(ROOT/'entrypoint.py').read_text(),
  'catalog_release/native.py':(ROOT/'native.py').read_text(),
  'catalog_release/rules.py':RULES.read_text()}
 for name,body in result.items():compile(body,name,'exec')
 return result


def build(source,destination):
 import importlib.util
 path=ROOT.parent/'platform_stores/build_overlay.py'
 spec=importlib.util.spec_from_file_location('catalog_release_composer',path)
 base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
 return base.build(source,destination,transform=native_sources,
                   marker=('catalog_release_overlay','catalog-release-v1'))
