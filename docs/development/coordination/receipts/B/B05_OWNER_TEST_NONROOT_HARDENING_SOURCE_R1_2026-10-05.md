# B05 owner-test non-root hardening source candidate — R1

## Scope

This result turns the already accepted B05 identity/path design and disposable
transient sandbox proof into an exact source-only owner-test systemd drop-in
candidate for API, worker and portal.

It does not install a unit, create an OS account/group, reload or restart
systemd, read a maintenance credential, change a database, choose production
capacity, or claim deployment/production acceptance.

## Accepted source boundary

The candidate uses three distinct static identities:

- API: octoport-owner-test-api
- worker: octoport-owner-test-worker
- portal: octoport-owner-test-portal

All three drop-ins require UMask=0077, NoNewPrivileges=yes, PrivateTmp=yes,
ProtectSystem=strict, ProtectHome=yes, an empty CapabilityBoundingSet and an
empty AmbientCapabilities.

Only API receives persistent writable state through
StateDirectory=octoport-owner-test-api with StateDirectoryMode=0700.
Worker and portal receive no StateDirectory, ReadWritePaths or other persistent
writable grant. No release-tree /opt write grant is introduced.

## Resource boundary

Accepted functional, sequential-100 and synchronized request-burst evidence is
diagnostic and explicitly not a representative production-capacity model.
Therefore this source candidate intentionally contains no MemoryHigh,
MemoryMax, CPUQuota or TasksMax directive.

A later reviewed task must select finite controls from an accepted
representative capacity model before live hardening can satisfy the full B05
resource-limit requirement.

## Maintenance-storage dependency

The current owner-authorized maintenance server-save contract points at
/root/octoport-control/credentials/maintenance.json. That destination is
incompatible with the proved non-root ProtectHome=yes API boundary.

The candidate validator therefore fails closed on any /root destination and
accepts only either no active maintenance credential path or
/var/lib/octoport-owner-test-api/maintenance.json.

This task does not edit the controller-owned maintenance-storage template.
Before any live non-root cutover, that separate authority must either establish
the accepted private state destination or prove that no active credential must
be preserved.

## Safety and live boundary

The validator is deterministic and source-only. It does not invoke systemctl,
useradd, groupadd, chmod, chown, provider/browser/network actions, or credential
reads. Live account creation, installed unit/drop-in mutation, credential
migration/revocation, finite resource-limit selection and service
restart/rollback require separate authority and exact reviewed evidence.
