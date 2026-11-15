"""Separate import environments, not a skip list for failed tests.

Foundation tests have no Django configuration. Stateful suites execute explicitly
through ci_qualified_suites.py in their own disposable DB/runtime environment.
A new discoverable package cannot silently disappear from qualification.
"""
from pathlib import Path
SPECIALIZED={
 'current_parameters':{'test_parameters':'base','test_producers':'base','test_collection':'collection','test_runtime_writer':'collection'},
 'parameter_dependencies':{'test_binding':'base','test_service':'base'},
 'parameter_compound':{'test_contract':'compound','test_worker':'compound','test_program_socket':'compound','test_review_races':'compound'},
 'economics_cohort':{'test_sources':'base','test_current':'base','test_reference':'base'},
 'economics_ledger':{'test_accruals':'base','test_worker':'ledger'},
}

def inventory(root):
 root=Path(root);found={}
 for directory in root.iterdir():
  if not directory.is_dir()or not(directory/'__init__.py').exists():continue
  modules={'.'.join(p.relative_to(directory).with_suffix('').parts) for p in directory.rglob('test_*.py')}
  if modules:
   if directory.name not in SPECIALIZED or modules!=set(SPECIALIZED[directory.name]):raise RuntimeError('TEST_SUITE_ENVIRONMENT_UNASSIGNED:'+directory.name)
   found[directory.name]=sorted(modules)
 if set(found)!=set(SPECIALIZED):raise RuntimeError('DECLARED_TEST_SUITE_MISSING')
 return sorted(p.stem for p in root.glob('test_*.py')),found

def labels(suite):
 return [package+'.'+module for package,modules in SPECIALIZED.items()for module,assigned in modules.items()if assigned==suite]
