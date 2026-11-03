import assert from "node:assert/strict";
import { test, after } from "node:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { deflateRawSync } from "node:zlib";
import { URL, pathToFileURL } from "node:url";
const cases = [
  { id: "stored-v10", method: 0, local: 10, central: 10, accept: true },
  { id: "stored-v20", method: 0, local: 20, central: 20, accept: true },
  { id: "deflate-v20", method: 8, local: 20, central: 20, accept: true },
  {
    id: "directory-v20",
    method: 0,
    local: 20,
    central: 20,
    directory: true,
    accept: true,
  },
  {
    id: "unsupported-store-version-0",
    method: 0,
    local: 0,
    central: 0,
    accept: false,
  },
  {
    id: "unsupported-store-version-9",
    method: 0,
    local: 9,
    central: 9,
    accept: false,
  },
  {
    id: "unsupported-store-version-11",
    method: 0,
    local: 11,
    central: 11,
    accept: false,
  },
  {
    id: "unsupported-store-version-21",
    method: 0,
    local: 21,
    central: 21,
    accept: false,
  },
  {
    id: "unsupported-store-version-45",
    method: 0,
    local: 45,
    central: 45,
    accept: false,
  },
  {
    id: "unsupported-store-version-63",
    method: 0,
    local: 63,
    central: 63,
    accept: false,
  },
  {
    id: "unsupported-store-version-255",
    method: 0,
    local: 255,
    central: 255,
    accept: false,
  },
  {
    id: "unsupported-store-version-65535",
    method: 0,
    local: 65535,
    central: 65535,
    accept: false,
  },
  {
    id: "deflate-underdeclared-v10",
    method: 8,
    local: 10,
    central: 10,
    accept: false,
  },
  {
    id: "directory-underdeclared-v10",
    method: 0,
    local: 10,
    central: 10,
    directory: true,
    accept: false,
  },
  {
    id: "local-future-central20",
    method: 0,
    local: 255,
    central: 20,
    accept: false,
  },
  {
    id: "local20-central-future",
    method: 0,
    local: 20,
    central: 255,
    accept: false,
  },
  {
    id: "local10-central20-mismatch",
    method: 0,
    local: 10,
    central: 20,
    accept: false,
  },
  {
    id: "local20-central10-mismatch",
    method: 0,
    local: 20,
    central: 10,
    accept: false,
  },
];
const pythonSource =
  'import sys,json,struct,zlib,io,zipfile,hashlib\nrows=[]\nfor c in json.load(sys.stdin):\n name=b"folder/" if c.get("directory") else b"payload.txt"\n data=b"" if c.get("directory") else b"synthetic"\n if c["method"]==8:\n  enc=zlib.compressobj(wbits=-15);packed=enc.compress(data)+enc.flush()\n else:packed=data\n crc=zlib.crc32(data)&0xffffffff\n local=bytearray(30);struct.pack_into("<IHHH",local,0,0x04034b50,c["local"],0,c["method"]);struct.pack_into("<H",local,12,0x5d5f);struct.pack_into("<IIIH",local,14,crc,len(packed),len(data),len(name))\n central=bytearray(46);struct.pack_into("<IHHHH",central,0,0x02014b50,20,c["central"],0,c["method"]);struct.pack_into("<H",central,14,0x5d5f);struct.pack_into("<IIIH",central,16,crc,len(packed),len(data),len(name));struct.pack_into("<I",central,38,0x10 if c.get("directory") else 0)\n localbytes=bytes(local)+name+packed;directory=bytes(central)+name\n end=bytearray(22);struct.pack_into("<I",end,0,0x06054b50);struct.pack_into("<HHII",end,8,1,1,len(directory),len(localbytes))\n raw=localbytes+directory+bytes(end)\n row={"id":c["id"],"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}\n try:\n  with zipfile.ZipFile(io.BytesIO(raw)) as z:out=z.read(name.decode())\n  row.update(accepted=True,payload_matches=out==data)\n except Exception as e:row.update(accepted=False,error_type=type(e).__name__,error=str(e))\n rows.append(row)\nprint(json.dumps({"consumer":"Python standard zipfile; independent buffer builder/zlib CRC","rows":rows}))\n';
const target =
  process.env.C01_LIBRARY_UNDER_TEST ||
  new URL("./release-lib.mjs", import.meta.url).pathname;
const { readZip } = await import(pathToFileURL(target).href);
const referenceProcess = spawnSync("/usr/bin/python3", ["-c", pythonSource], {
  input: JSON.stringify(cases),
  encoding: "utf8",
  timeout: 10000,
  maxBuffer: 1024 * 1024,
});
assert.equal(referenceProcess.status, 0, referenceProcess.stderr);
const reference = JSON.parse(referenceProcess.stdout);
const referenceRows = new Map(reference.rows.map((row) => [row.id, row]));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function fixture(c) {
  const name = Buffer.from(c.directory ? "folder/" : "payload.txt");
  const data = Buffer.from(c.directory ? "" : "synthetic");
  const compressed = c.method === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(c.local, 4);
  local.writeUInt16LE(c.method, 8);
  local.writeUInt16LE(0x5d5f, 12);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(c.central, 6);
  central.writeUInt16LE(c.method, 10);
  central.writeUInt16LE(0x5d5f, 14);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(c.directory ? 0x10 : 0, 38);
  const body = Buffer.concat([local, name, compressed]),
    dir = Buffer.concat([central, name]);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(body.length, 16);
  return {
    bytes: Buffer.concat([body, dir, end]),
    name: name.toString(),
    data,
  };
}
const rows = [];
for (const c of cases) {
  test("bounded STORE ZIP extraction version: " + c.id, () => {
    const f = fixture(c),
      ref = referenceRows.get(c.id);
    let accepted = false,
      error,
      payloadMatches = false;
    try {
      const entries = readZip(f.bytes);
      accepted = true;
      payloadMatches = entries.get(f.name)?.equals(f.data) === true;
    } catch (e) {
      error = e.message;
    }
    const sameBytes =
      ref.sha256 === sha256(f.bytes) && ref.bytes === f.bytes.length;
    const pass =
      sameBytes && (c.accept ? accepted && payloadMatches : !accepted);
    rows.push({
      ...c,
      fixture_bytes: f.bytes.length,
      fixture_sha256: sha256(f.bytes),
      reference_same_bytes: sameBytes,
      actual_accepted: accepted,
      payload_matches: payloadMatches,
      error,
      reference_accepted: ref.accepted,
      reference_error: ref.error,
      reference_error_type: ref.error_type,
      pass,
    });
    assert.equal(
      sameBytes,
      true,
      "Independent Python control must consume byte-identical ZIP",
    );
    assert.equal(
      pass,
      true,
      "expected accept=" +
        c.accept +
        "; actual accept=" +
        accepted +
        "; error=" +
        (error || "none"),
    );
  });
}
after(() => {
  const evidence = {
    phase: process.env.C01_PHASE || "CANDIDATE",
    module: target,
    module_sha256: sha256(readFileSync(target)),
    scope:
      "Only synthetic ZIP buffers in memory; no archive files/extraction/prepare/preflight/provider/DB",
    reference_consumer: reference.consumer,
    total: rows.length,
    passed: rows.filter((x) => x.pass).length,
    failed: rows.filter((x) => !x.pass).length,
    harness_errors: rows.filter((x) => !x.reference_same_bytes).length,
    rows,
  };
  if (process.env.C01_EVIDENCE_OUTPUT)
    writeFileSync(
      process.env.C01_EVIDENCE_OUTPUT,
      JSON.stringify(evidence, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
});
