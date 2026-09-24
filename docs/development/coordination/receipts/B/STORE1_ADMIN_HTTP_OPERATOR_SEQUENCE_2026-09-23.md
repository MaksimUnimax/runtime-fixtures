# STORE-1 admin HTTP operator sequence — source receipt

Status: SOURCE/DISPOSABLE ONLY. This is an operator sequence for a future authorized catalog activation. It does not authorize a live database mutation, deployment, beta admission change, store submission, or production publication.

## Normal operator sequence

1. Obtain the exact future Opera store ZIP bytes and calculate their SHA256. Publish extension release `0.2.4` through `POST /v1/admin/compatibility/releases/0.2.4/publish` with `releaseChannel: "stable"`, that exact `artifactSha256`, `supportedContracts: ["control_plane_v2"]`, and `supportedBrowsers: ["opera"]`. The request supplies no database IDs or `releasedAt`; the server assigns the publication time.
2. Publish policy `store1.opera.v2` through `POST /v1/admin/compatibility/policies/store1.opera.v2/publish` with `contractVersion: "control_plane_v2"`, `browserFamily: "opera"`, minimum and recommended extension `0.2.4`, and minimum browser `136`.
3. Use the existing P7 admin AI routes to publish the ChatGPT Standard adapter, surface, variant, and profile chain.
4. Use the existing P7 admin assignment route to select the compatible ChatGPT Standard profile for Opera.
5. Read back compatibility and AI resolution through the normal admin/bootstrap paths and verify `SUPPORTED` / `RESOLVED` for the exact Opera package and contract.

The artifact digest must be calculated from the future store ZIP. Do not substitute a local-development package digest.

## Remaining operator gap

Config-release linking to the compatibility policy still has no normal operator HTTP path. Do not use direct SQL or the validation CLI as a substitute. This task leaves config publication/linking as the exact remaining operator gap for a separately authorized source task.

Beta admission remains `CLOSED`; none of these source changes open admission. No live activation or store submission is represented by this receipt.
