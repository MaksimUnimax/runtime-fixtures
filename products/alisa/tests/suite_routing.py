"""Separate import environments, not a skip list for failed tests.

Foundation tests have no Django configuration. Stateful suites execute explicitly
through ci_qualified_suites.py in their own disposable DB/runtime environment.
A new discoverable package cannot silently disappear from qualification.
"""
from pathlib import Path
SPECIALIZED={
 'current_parameters':{'test_parameters':'base','test_producers':'base','test_collection':'collection','test_runtime_writer':'collection'},
 'parameter_dependencies':{'test_binding':'base','test_service':'base'},
 'parameter_compound':{'test_contract':'compound','test_worker':'compound','test_program_socket':'compound','test_review_races':'compound','test_composite_worker':'compound','test_composite_races':'compound'},
 'economics_cohort':{'test_sources':'base','test_current':'base','test_reference':'base','test_query_current':'base','test_composite_sources':'base'},
 'economics_ledger':{'test_accruals':'base','test_realization':'base','test_tariffs':'base','test_period_costs':'base','test_period_current':'base','test_order_sources':'base','test_other_sources':'base','test_period_worker':'ledger','test_realization_worker':'ledger','test_worker':'ledger','test_tariff_worker':'ledger','test_order_worker':'ledger','test_other_worker':'ledger'},
 'owner_catalog':{'test_catalog_ipc':'ledger','test_product_catalog':'ledger'},
}

# Explicit, exact module inventories for environments not owned by this runner.
# The catalogue already has an unchanged separate CI step. The legacy client
# requires its frozen R01.1 package and is not counted in current-core PASS.
EXTERNAL={
 'question_catalog':{'test_catalog':'existing alisa-platform-ci Read-only question catalogue step'},
 'runtime_client':{'test_job_client':'historical RT-JOB-R01.1 package qualification; NOT_RUN by this change'},
}

def inventory(root):
 root=Path(root);found={}
 if root.is_symlink()or any(p.is_symlink()for p in root.rglob('*')):raise RuntimeError('TEST_TREE_SYMLINK_DENIED')
 for directory in root.iterdir():
  if not directory.is_dir():continue
  modules={'.'.join(p.relative_to(directory).with_suffix('').parts) for p in directory.rglob('test_*.py')}
  if modules:
   declared={**SPECIALIZED,**EXTERNAL}
   if directory.name not in declared or modules!=set(declared[directory.name]):raise RuntimeError('TEST_SUITE_ENVIRONMENT_UNASSIGNED:'+directory.name)
   found[directory.name]=sorted(modules)
 if set(found)!=set(SPECIALIZED)|set(EXTERNAL):raise RuntimeError('DECLARED_TEST_SUITE_MISSING')
 if any(value not in ('base','collection','compound','ledger')for modules in SPECIALIZED.values()for value in modules.values()):raise RuntimeError('TEST_SUITE_EXECUTOR_UNKNOWN')
 return sorted(p.stem for p in root.glob('test_*.py')),found

def labels(suite):
 return [package+'.'+module for package,modules in SPECIALIZED.items()for module,assigned in modules.items()if assigned==suite]
