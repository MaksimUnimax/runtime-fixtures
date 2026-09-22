import { createHash } from "node:crypto";
import { acquireOfficialSource } from "./acquire.js";
import type {
  AuthorityRecord,
  FamilyManifest,
  OperationInventory,
  SourceDocumentAuthority,
  SourceRegistry,
  SourceRegistryEntry,
} from "./types.js";
import type { ApiWatchStore } from "./types.js";
import type { SwaggerSourceStore } from "@product/monitoring-control";
import { promoteAcceptedSnapshot } from "./snapshot.js";
import { buildCompleteOperationInventory } from "./inventory.js";

export function canonicalFamilyManifest(input: {
  sourceFamily: "WILDBERRIES";
  documents: Array<{
    documentKey: string;
    sha256: string;
    sizeBytes: number;
    specVersion: string;
  }>;
}): FamilyManifest {
  const documents = [...input.documents].sort((a, b) =>
    a.documentKey.localeCompare(b.documentKey),
  );
  if (
    new Set(documents.map((document) => document.documentKey)).size !==
    documents.length
  )
    throw new Error("DUPLICATE_SOURCE_DOCUMENT_KEY");
  const canonical = documents
    .map(
      (document) =>
        `${document.documentKey}\t${document.sha256}\t${document.sizeBytes}\t${document.specVersion}`,
    )
    .join("\n");
  return {
    sourceFamily: input.sourceFamily,
    manifestSha256: createHash("sha256").update(canonical).digest("hex"),
    documents,
  };
}

export function familyAuthorityStatus(
  documents: readonly SourceDocumentAuthority[],
  requiredDocumentKeys: readonly string[],
):
  | "AUTHORITY_ACCEPTED"
  | "AUTHORITY_PARTIAL"
  | "AUTHORITY_BLOCKED"
  | "AUTHORITY_REVIEW_REQUIRED" {
  const accepted = new Set(
    documents
      .filter((document) => document.authorityStatus === "AUTHORITY_ACCEPTED")
      .map((document) => document.documentKey),
  );
  if (accepted.size === requiredDocumentKeys.length)
    return "AUTHORITY_ACCEPTED";
  if (accepted.size > 0) return "AUTHORITY_PARTIAL";
  if (
    documents.some(
      (document) => document.authorityStatus === "AUTHORITY_REVIEW_REQUIRED",
    )
  )
    return "AUTHORITY_REVIEW_REQUIRED";
  return "AUTHORITY_BLOCKED";
}

export function combineWildberriesInventories(
  inventories: readonly OperationInventory[],
): OperationInventory & { duplicateIdentities: string[] } {
  const operations = inventories.flatMap((inventory) => inventory.operations);
  const grouped = new Map<string, number>();
  for (const operation of operations)
    grouped.set(operation.identity, (grouped.get(operation.identity) ?? 0) + 1);
  const duplicateIdentities = [...grouped.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity)
    .sort();
  const operationsByMethod: Record<string, number> = {};
  for (const operation of operations)
    operationsByMethod[operation.method] =
      (operationsByMethod[operation.method] ?? 0) + 1;
  return {
    sourceFamily: "WILDBERRIES",
    snapshotSha256: createHash("sha256")
      .update(
        inventories
          .map((inventory) => inventory.snapshotSha256)
          .sort()
          .join("\n"),
      )
      .digest("hex"),
    pathCount: new Set(operations.map((operation) => operation.path)).size,
    operationCount: operations.length,
    operationsByMethod,
    deprecatedCount: operations.filter((operation) => operation.deprecated)
      .length,
    operationIdPresentCount: operations.filter(
      (operation) => operation.operationId !== null,
    ).length,
    operationIdMissingCount: operations.filter(
      (operation) => operation.operationId === null,
    ).length,
    operations,
    duplicateIdentities,
  };
}

export async function runDocumentAuthorityPass(input: {
  registry: SourceRegistry;
  store: ApiWatchStore;
  pendingStore: SwaggerSourceStore;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<{
  documents: SourceDocumentAuthority[];
  records: AuthorityRecord[];
  outcomes: Array<
    ReturnType<typeof acquireOfficialSource> extends Promise<infer T>
      ? T
      : never
  >;
}> {
  const now = input.now ?? (() => new Date());
  const documents: SourceDocumentAuthority[] = [];
  const records: AuthorityRecord[] = [];
  const outcomes: Awaited<ReturnType<typeof acquireOfficialSource>>[] = [];
  for (const entry of input.registry.list()) {
    const configuredDocuments = entry.documents?.length
      ? entry.documents
      : entry.officialUrl
        ? [
            {
              documentKey: entry.sourceFamily,
              officialUrl: entry.officialUrl,
              expectedArtifactTypes: entry.expectedArtifactTypes,
            },
          ]
        : [undefined];
    for (const document of configuredDocuments) {
      const fetchedOutcome = await acquireOfficialSource({
        entry,
        document,
        fetcher: input.fetcher,
      });
      const outcome = document
        ? { ...fetchedOutcome, documentKey: document.documentKey }
        : fetchedOutcome;
      outcomes.push(outcome);
      if (outcome.kind === "OPERATOR_SOURCE_REQUIRED") {
        const officialUrl = document?.officialUrl ?? entry.officialUrl;
        if (officialUrl) {
          const existing = await input.pendingStore.findOpenRequest(
            entry.sourceFamily,
            officialUrl,
            now(),
            document?.documentKey,
          );
          if (!existing)
            await input.pendingStore.createRequest({
              requestId: document
                ? `${entry.sourceFamily}:${document.documentKey}`
                : undefined,
              sourceFamily: entry.sourceFamily,
              documentKey: document?.documentKey,
              officialUrl,
              expectedArtifactType:
                document?.expectedArtifactTypes.join(",") ??
                entry.expectedArtifactTypes.join(","),
              createdAt: now(),
              blockerReason: outcome.blockerReason,
            });
        }
      }
      const accepted = outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE";
      const record = await input.store.saveAuthorityRecord({
        sourceFamily: entry.sourceFamily,
        officialUrl: document?.officialUrl ?? entry.officialUrl,
        acquisitionMode: "AUTOMATIC",
        authorityStatus: accepted
          ? "AUTHORITY_ACCEPTED"
          : outcome.kind === "INVALID_OFFICIAL_SOURCE_RESPONSE"
            ? "AUTHORITY_REJECTED"
            : "AUTHORITY_BLOCKED",
        sha256: accepted ? outcome.sha256 : null,
        sizeBytes: accepted ? outcome.sizeBytes : null,
        specVersion: accepted ? outcome.specVersion : null,
        acquiredAt: accepted ? now() : null,
        validatedAt: now(),
        operatorRequestId: null,
        artifactExtension: accepted
          ? `.${outcome.artifactType.toLowerCase()}`
          : null,
        safeProvenance: {
          ...(document ? { documentKey: document.documentKey } : {}),
          finalUrl: accepted ? outcome.finalUrl : null,
        },
        failureClassification: accepted ? null : outcome.kind,
      });
      records.push(record);
      if (document)
        documents.push({
          sourceFamily: entry.sourceFamily,
          documentKey: document.documentKey,
          officialUrl: document.officialUrl,
          status: accepted
            ? "ACQUIRED"
            : outcome.kind === "OPERATOR_SOURCE_REQUIRED"
              ? "OPERATOR_SOURCE_REQUIRED"
              : outcome.kind === "SOURCE_TEMPORARILY_UNAVAILABLE"
                ? "SOURCE_TEMPORARILY_UNAVAILABLE"
                : "INVALID",
          sha256: accepted ? outcome.sha256 : null,
          sizeBytes: accepted ? outcome.sizeBytes : null,
          specVersion: accepted ? outcome.specVersion : null,
          authorityStatus: record.authorityStatus,
          blockerReason: accepted ? null : outcome.blockerReason,
        });
    }
  }
  return { documents, records, outcomes };
}

export async function activateProductionSources(input: {
  registry: SourceRegistry;
  store: ApiWatchStore;
  pendingStore: SwaggerSourceStore;
  snapshotRoot?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const pass = await runDocumentAuthorityPass(input);
  const inventories: OperationInventory[] = [];
  for (const [index, outcome] of pass.outcomes.entries()) {
    if (outcome.kind !== "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE") continue;
    const entry = input.registry.get(outcome.sourceFamily);
    const document = entry.documents?.find(
      (candidate) => candidate.documentKey === outcome.documentKey,
    );
    const record = pass.records[index];
    if (!document || !record) continue;
    const snapshot = await promoteAcceptedSnapshot({
      record,
      bytes: outcome.bytes,
      store: input.store,
      snapshotRoot: input.snapshotRoot,
      documentKey: document.documentKey,
      now: input.now,
    });
    const inventory = buildCompleteOperationInventory({
      sourceFamily: outcome.sourceFamily,
      documentKey: document.documentKey,
      snapshotSha256: snapshot.sha256,
      bytes: outcome.bytes,
      filename: `source${outcome.artifactType === "YAML" ? ".yaml" : outcome.artifactType === "YML" ? ".yml" : ".json"}`,
    });
    await input.store.saveInventory(inventory);
    inventories.push(inventory);
  }
  const wbDocuments = pass.documents.filter(
    (document) => document.sourceFamily === "WILDBERRIES",
  );
  const wbEntry = input.registry
    .list()
    .find((entry) => entry.sourceFamily === "WILDBERRIES");
  const wbStatus = wbEntry
    ? familyAuthorityStatus(
        wbDocuments,
        (wbEntry.documents ?? []).map((document) => document.documentKey),
      )
    : null;
  const manifest =
    wbStatus === "AUTHORITY_ACCEPTED"
      ? canonicalFamilyManifest({
          sourceFamily: "WILDBERRIES",
          documents: wbDocuments.map((document) => ({
            documentKey: document.documentKey,
            sha256: document.sha256!,
            sizeBytes: document.sizeBytes!,
            specVersion: document.specVersion!,
          })),
        })
      : null;
  const duplicateIdentities =
    inventories.filter((inventory) => inventory.sourceFamily === "WILDBERRIES")
      .length > 1
      ? combineWildberriesInventories(
          inventories.filter(
            (inventory) => inventory.sourceFamily === "WILDBERRIES",
          ),
        ).duplicateIdentities
      : [];
  return { ...pass, inventories, wbStatus, manifest, duplicateIdentities };
}

export function sourceEntryForDocument(
  registry: SourceRegistry,
  sourceFamily: SourceRegistryEntry["sourceFamily"],
  documentKey: string,
) {
  const entry = registry.get(sourceFamily);
  const document = entry.documents?.find(
    (candidate) => candidate.documentKey === documentKey,
  );
  if (!document) throw new Error("SOURCE_DOCUMENT_NOT_REGISTERED");
  return { entry, document };
}
