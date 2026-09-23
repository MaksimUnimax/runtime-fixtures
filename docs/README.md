# Документация Octoport

**Текущая программа:** [единая разработка A/B/C](development/coordination/README.md), [план](development/coordination/PLAN.md), [база](development/coordination/BASELINE_2026-09-23.md). Старые Stream-1/Stream-2 документы сохраняются как исторические receipts.

This directory contains implementation-oriented technical notes, contracts, validation records, migration evidence, and operational procedures for the workspace.

## Architecture

- [System overview](architecture/OVERVIEW.md)
- [Repository structure](architecture/REPOSITORY.md)
- [Data and security](architecture/DATA_AND_SECURITY.md)
- [Shared contracts](architecture/CONTRACTS.md)
- [Synchronization rules](architecture/SYNC.md)
- [State machines](architecture/STATE_MACHINES.md)

## Development and validation

- [Development workflow](development/WORKFLOW.md)
- [Quality rules](development/QUALITY.md)
- [Acceptance matrix](development/ACCEPTANCE_MATRIX.md)
- [Failure ledger](development/FAILURE_LEDGER.md)

## Operations

- [Release and recovery](operations/RELEASE_AND_RECOVERY.md)
- [Monitoring](operations/MONITORING.md)
- [Capacity](operations/CAPACITY.md)

## Integration material

Provider- and surface-specific implementation notes live under `integrations/` and the relevant application/package directories. Read only the area required by the active task.

## Migration and evidence

Historical import, migration, and acceptance evidence lives under `migration/`. Evidence records describe the scope that was checked at a specific revision; they are not a substitute for current runtime verification.

## Current coordination files

`STATUS.md`, `ROADMAP.md`, and `decisions/` are maintenance records. Do not infer permission to start a new stage merely because an older record mentions it.

## Documentation rule

Keep durable rules in one canonical technical document and link to them elsewhere. When behavior changes, update the affected contract and the validation scenario that proves it. Historical evidence keeps its original meaning and should not be rewritten as current acceptance.
