import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SwaggerArtifact } from "@product/monitoring-control";
import type {
  ApiWatchReportStore,
  ApiWatchStore,
  AuthorityRecord,
} from "./types.js";

export type OperatorPipelineCandidate = {
  artifact: Pick<SwaggerArtifact, "artifactId" | "requestId" | "sha256">;
  records: AuthorityRecord[];
};

type ConsumptionReceipt = {
  version: 1;
  artifactId: string;
  requestId: string;
  outerSha256: string;
  reportId: string;
  members: Array<{ recordId: string; documentKey: string; sha256: string }>;
};

function receiptPath(root: string, artifactId: string): string {
  return join(
    root,
    "wb-consumed-" +
      createHash("sha256").update(artifactId).digest("hex") +
      ".json",
  );
}

async function readReceipt(
  path: string,
): Promise<ConsumptionReceipt | undefined> {
  // Never open a FIFO in blocking mode, and do not silently drop the
  // no-follow requirement on a platform without either safety flag.
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)
    throw new Error("OPERATOR_RECEIPT_SAFE_OPEN_UNAVAILABLE");
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024)
      throw new Error("OPERATOR_RECEIPT_INVALID");
    // A file may grow after fstat. Read at most the claimed size plus one
    // byte to detect growth, never readFile() to an unbounded EOF.
    const bytes = Buffer.alloc(stat.size + 1);
    let received = 0;
    while (received < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        received,
        bytes.length - received,
        received,
      );
      if (bytesRead === 0) break;
      received += bytesRead;
    }
    if (received !== stat.size) throw new Error("OPERATOR_RECEIPT_INVALID");
    try {
      return JSON.parse(
        bytes.subarray(0, received).toString("utf8"),
      ) as ConsumptionReceipt;
    } catch {
      throw new Error("OPERATOR_RECEIPT_INVALID");
    }
  } finally {
    await handle.close();
  }
}

// The upload/request or even all accepted authority rows are not completion.
// A receipt is usable only with the real terminal report and all 13 exact members.
async function verifyReceipt(input: {
  receipt: ConsumptionReceipt;
  artifact: OperatorPipelineCandidate["artifact"];
  store: ApiWatchStore;
  reportStore: ApiWatchReportStore;
}): Promise<void> {
  const { receipt, artifact, store, reportStore } = input;
  const invalid = () => {
    throw new Error("OPERATOR_RECEIPT_INVALID");
  };
  if (
    !receipt ||
    receipt.version !== 1 ||
    receipt.artifactId !== artifact.artifactId ||
    receipt.requestId !== artifact.requestId ||
    receipt.outerSha256 !== artifact.sha256 ||
    typeof receipt.reportId !== "string" ||
    !Array.isArray(receipt.members) ||
    receipt.members.length !== 13 ||
    receipt.members.some(
      (x) =>
        !x ||
        typeof x.recordId !== "string" ||
        typeof x.documentKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(x.sha256),
    ) ||
    new Set(receipt.members.map((x) => x.documentKey)).size !== 13 ||
    new Set(receipt.members.map((x) => x.recordId)).size !== 13
  )
    invalid();
  const report = await reportStore.getReport(receipt.reportId);
  if (
    !report ||
    !["COMPLETED", "PARTIAL"].includes(report.state) ||
    !report.completedAt
  )
    invalid();
  const sources = report!.sources.filter(
    (x) => x.sourceFamily === "WILDBERRIES",
  );
  if (sources.length !== 13) invalid();
  for (const member of receipt.members) {
    const record = await store.findAuthorityRecord(member.recordId);
    const source = sources.find((x) => x.documentKey === member.documentKey);
    if (
      !record ||
      record.sourceFamily !== "WILDBERRIES" ||
      record.authorityStatus !== "AUTHORITY_ACCEPTED" ||
      record.acquisitionMode !== "OPERATOR_SUPPLIED" ||
      record.operatorRequestId !== artifact.requestId ||
      record.sha256 !== member.sha256 ||
      record.safeProvenance.bundleArtifactId !== artifact.artifactId ||
      record.safeProvenance.outerBundleSha256 !== artifact.sha256 ||
      record.safeProvenance.documentKey !== member.documentKey ||
      !source ||
      source.snapshotSha256 !== member.sha256 ||
      source.authorityStatus !== "AUTHORITY_ACCEPTED" ||
      source.acquisitionOutcome !== "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" ||
      source.blockerCode !== null ||
      source.inventoryOperationCount === null ||
      !["FIRST_SNAPSHOT", "CHANGED", "NO_CHANGE"].includes(
        source.changeMode ?? "",
      ) ||
      (source.errorCode !== null &&
        source.errorCode !== "PRODUCT_BASELINE_MISSING" &&
        source.errorCode !== "PRODUCT_BASELINE_REPOSITORY_UNAVAILABLE")
    )
      invalid();
  }
}

export async function operatorPipelineConsumed(input: {
  artifact: OperatorPipelineCandidate["artifact"];
  store: ApiWatchStore;
  reportStore?: ApiWatchReportStore;
  quarantineDir: string;
}): Promise<boolean> {
  if (!input.reportStore) return false;
  const receipt = await readReceipt(
    receiptPath(input.quarantineDir, input.artifact.artifactId),
  );
  if (!receipt) return false;
  await verifyReceipt({ ...input, reportStore: input.reportStore, receipt });
  return true;
}

export async function completeOperatorPipeline(input: {
  candidate: OperatorPipelineCandidate;
  reportId: string;
  store: ApiWatchStore;
  reportStore: ApiWatchReportStore;
  quarantineDir: string;
}): Promise<void> {
  const { artifact, records } = input.candidate;
  const receipt: ConsumptionReceipt = {
    version: 1,
    artifactId: artifact.artifactId,
    requestId: artifact.requestId,
    outerSha256: artifact.sha256,
    reportId: input.reportId,
    members: records.map((record) => ({
      recordId: record.recordId,
      documentKey: String(record.safeProvenance.documentKey),
      sha256: record.sha256!,
    })),
  };
  await verifyReceipt({ ...input, artifact, receipt });
  const path = receiptPath(input.quarantineDir, artifact.artifactId);
  const temporary = path + "." + randomUUID() + ".tmp";
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(receipt) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // Concurrent successful reports keep the first proven receipt.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readReceipt(path);
      if (!existing) throw new Error("OPERATOR_RECEIPT_MISSING");
      await verifyReceipt({ ...input, artifact, receipt: existing });
    }
    const directory = await open(input.quarantineDir, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporary);
  }
}
