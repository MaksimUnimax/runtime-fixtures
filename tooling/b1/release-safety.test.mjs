import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  preflight as validateCandidate,
  prepare as prepareCandidate,
  productFacts,
  sourceIdentity,
} from "./release-lib.mjs";

const NODE = process.execPath;
const prepareTool = resolve("tooling/b1/prepare-release-candidate.mjs");
const preflightTool = resolve("tooling/b1/release-preflight.mjs");

function makeTrustBundle(keyId) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId,
        publicKey: der.toString("base64"),
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
}

const trustedBundle = makeTrustBundle("fixture-release-key");
const attackerBundle = makeTrustBundle("attacker-release-key");
const FIREFOX_STORE_ID = "octoport@octoport.ru";
const BASE_ORIGINS = {
  controlApiOrigin: "https://api.fixture.invalid",
  portalOrigin: "https://app.fixture.invalid",
};

function releaseAuthority(overrides = {}) {
  const facts = productFacts();
  const base = {
    schemaVersion: "octoport_release_authority_v1",
    source: sourceIdentity(),
    productVersion: facts.productVersion,
    contractVersion: facts.contractVersion,
    migrationLevel: facts.migrationLevel,
    environment: "PREPRODUCTION",
    origins: BASE_ORIGINS,
    trustBundle: trustedBundle,
  };
  return {
    ...base,
    ...overrides,
    source: overrides.source ?? base.source,
    origins: overrides.origins ?? base.origins,
    trustBundle: overrides.trustBundle ?? base.trustBundle,
  };
}

function packagedConfig(authority, overrides = {}) {
  return {
    environment: authority.environment,
    controlApiOrigin: authority.origins.controlApiOrigin,
    portalOrigin: authority.origins.portalOrigin,
    extensionVersion: authority.productVersion,
    contractVersion: authority.contractVersion,
    trustBundle: authority.trustBundle,
    ...overrides,
  };
}

const ZIP_WRITER = String.raw`
import base64,sys,zipfile,struct,io,zlib
path,browser,mode,manifest64,worker64,icon64=sys.argv[1:7]
manifest=base64.b64decode(manifest64)
worker=base64.b64decode(worker64)
rows=[("manifest.json",manifest),("worker.js",worker)]
if mode in ("valid_declared_icon","short_declared_icon","unknown_critical_png","nonconsecutive_idat_png","png_highbit_ihdr","png_trailing_idat","png_invalid_trns_rgba","png_metadata_text","png_consecutive_idat","png_bkgd_after_idat","png_bad_bkgd_length"):
    icon=base64.b64decode(icon64)
    def chunk(kind,payload):
        return struct.pack(">I",len(payload))+kind+payload+struct.pack(">I",zlib.crc32(kind+payload))
    if mode=="short_declared_icon":
        ihdr=struct.pack(">IIBBBBB",16,16,8,6,0,0,0)
        # Claims RGBA but only one byte/pixel, the exact legacy defect class.
        icon=(bytes((137,80,78,71,13,10,26,10))+chunk(b"IHDR",ihdr)
              +chunk(b"IDAT",zlib.compress((b"\x00"+bytes(16))*16))
              +chunk(b"IEND",b""))
    if mode=="unknown_critical_png":
        # New uppercase critical chunk with valid CRC: conforming PNG readers reject it.
        icon=icon[:33]+chunk(b"ABCD",b"")+icon[33:]
    if mode=="nonconsecutive_idat_png":
        # Equivalent compressed bytes, but an ancillary tEXt breaks contiguous IDAT.
        result=bytearray(icon[:8]);pos=8;split=False
        while pos<len(icon):
            length=struct.unpack_from(">I",icon,pos)[0]
            kind=icon[pos+4:pos+8]
            payload=icon[pos+8:pos+8+length]
            pos+=12+length
            if kind==b"IDAT" and not split:
                middle=len(payload)//2
                assert middle>0
                result+=chunk(b"IDAT",payload[:middle])
                result+=chunk(b"tEXt",b"Comment"+bytes((0,))+b"fixture")
                result+=chunk(b"IDAT",payload[middle:])
                split=True
            else:result+=chunk(kind,payload)
        assert split
        icon=bytes(result)
    if mode=="png_highbit_ihdr":
        # 0xC9 is not an ASCII letter, but Node Buffer "ascii" decodes it as I.
        assert icon[12:16]==b"IHDR" and len(icon)>=33
        icon=icon[:8]+chunk(bytes((201,72,68,82)),icon[16:29])+icon[33:]
    if mode=="png_trailing_idat":
        # CRC-correct payload with bytes after the zlib end marker.
        parts=[];pos=8
        while pos<len(icon):
            length=struct.unpack_from(">I",icon,pos)[0]
            kind=icon[pos+4:pos+8]
            payload=icon[pos+8:pos+8+length]
            parts.append((kind,payload))
            pos+=length+12
        idats=[i for i,(kind,_) in enumerate(parts) if kind==b"IDAT"]
        assert idats and pos==len(icon)
        last=idats[-1]
        parts[last]=(b"IDAT",parts[last][1]+b"C01_NONPRIVATE_TRAILING_ZLIB_BYTES")
        icon=icon[:8]+b"".join(chunk(kind,payload) for kind,payload in parts)
    if mode=="png_invalid_trns_rgba":
        # A CRC-correct tRNS after IDAT is invalid in RGBA, even if the
        # decompressed raster stays unchanged.
        assert icon[-8:-4]==b"IEND"
        icon=icon[:-12]+chunk(b"tRNS",bytes((0,0)))+icon[-12:]
    if mode=="png_metadata_text":
        # Unknown optional metadata is not in canonical Octoport release icons.
        assert icon[12:16]==b"IHDR"
        icon=icon[:33]+chunk(b"tEXt",b"Comment"+bytes((0,))+b"fixture")+icon[33:]
    if mode in ("png_consecutive_idat","png_bkgd_after_idat","png_bad_bkgd_length"):
        # Preserve real Cairo output, including its required-order bKGD metadata.
        parts=[];pos=8
        while pos<len(icon):
            length=struct.unpack_from(">I",icon,pos)[0]
            kind=icon[pos+4:pos+8]
            payload=icon[pos+8:pos+8+length]
            parts.append((kind,payload))
            pos+=12+length
        assert pos==len(icon)
        if mode=="png_consecutive_idat":
            result=[];split=False
            for kind,payload in parts:
                if kind==b"IDAT" and not split:
                    mid=len(payload)//2
                    assert mid>0
                    result.extend([(b"IDAT",payload[:mid]),(b"IDAT",payload[mid:])])
                    split=True
                else:result.append((kind,payload))
            assert split
            parts=result
        if mode=="png_bkgd_after_idat":
            bg=[i for i,(kind,_) in enumerate(parts) if kind==b"bKGD"]
            assert len(bg)==1 and parts[-1][0]==b"IEND"
            background=parts.pop(bg[0])
            parts.insert(-1,background)
        if mode=="png_bad_bkgd_length":
            bg=[i for i,(kind,_) in enumerate(parts) if kind==b"bKGD"]
            assert len(bg)==1 and len(parts[bg[0]][1])==6
            parts[bg[0]]=(b"bKGD",parts[bg[0]][1][:5])
        icon=icon[:8]+b"".join(chunk(kind,payload) for kind,payload in parts)
    rows.append(("icons/icon-16.png",icon))
if mode=="no_runtime":
    rows=[row for row in rows if row[0]!="worker.js"]
if mode=="secret":
    rows.append(("private.pem",b"-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----"))
if mode=="secretfile":
    rows.append((".env",b"token=fixture"))
if mode=="path":
    rows.append(("../outside",b"bad"))
if mode=="absolute":
    rows.append(("/tmp/outside",b"bad"))
if mode=="backslash":
    rows.append(("..\\outside",b"bad"))
if mode=="duplicate":
    rows.append(("manifest.json",b"{}"))
if mode=="case_duplicate":
    rows.append(("MANIFEST.JSON",b"{}"))
if mode=="prefix_file_before_child":
    rows.extend([("assets",b"file"),("assets/logo.svg",b"child")])
if mode=="prefix_child_before_file":
    rows.extend([("assets/logo.svg",b"child"),("assets",b"file")])
if mode=="prefix_directory_then_file":
    rows.extend([("assets/",b""),("assets",b"file")])
if mode=="prefix_file_then_directory":
    rows.extend([("assets",b"file"),("assets/",b"")])
if mode=="prefix_mixed_case":
    rows.extend([("ASSETS",b"file"),("assets/logo.svg",b"child")])
if mode=="prefix_valid_parent_first":
    rows.extend([("assets/",b""),("assets/logo.svg",b"child")])
if mode=="prefix_valid_parent_last":
    rows.extend([("assets/logo.svg",b"child"),("assets/",b"")])
if mode=="prefix_depth_excess":
    rows.append(("/".join(["a"]*129)+".txt",b"too deep"))
if mode=="prefix_depth_limit":
    rows.append(("/".join(["a"]*128)+".txt",b"within depth"))
if mode=="prefix_deep_fanout_128":
    for i in range(128):
        first="u"+str(i).zfill(5)+"a"*92
        rows.append(("/".join([first]+["b"*100]*126+["leaf.txt"]),b"x"))
if mode.startswith("windows_unsafe_"):
    invalid_names={
        "windows_unsafe_ads":"content/worker.js:payload",
        "windows_unsafe_reserved":"AUX.txt",
        "windows_unsafe_child_device":"content/NUL.log",
        "windows_unsafe_unicode_device":"content/COM¹.log",
        "windows_unsafe_trailing_dot":"content/name.js.",
        "windows_unsafe_trailing_space":"content/name.js ",
        "windows_unsafe_wildcard":"content/name?.js",
        "windows_unsafe_control":"content/name\x1f.js",
        "windows_unsafe_nonascii_composed":"content/café.js",
        "windows_unsafe_nonascii_decomposed":"content/cafe\u0301.js",
        "windows_unsafe_nonascii_kelvin":"content/Kernel.js",
        "windows_unsafe_conin":"content/CONIN$.js",
        "windows_unsafe_conout":"CONOUT$.txt",
        "windows_unsafe_conout_directory":"content/CONOUT$/asset.js",
        "windows_unsafe_com0":"content/COM0.log",
        "windows_unsafe_lpt0":"content/LPT0.log",
    }
    rows.append((invalid_names[mode],b"non-private fixture"))
if mode=="windows_case_alias":
    rows.extend([
        ("content/Foo.js",b"first"),
        ("content/foo.js",b"second"),
    ])
if mode=="windows_portable_names":
    rows.extend([
        ("content/AUXiliary.js",b"portable"),
        ("content/COM10.js",b"portable"),
        ("content/LPT10.js",b"portable"),
        ("content/CONINput.js",b"portable"),
        ("content/CONOUTland.js",b"portable"),
        ("content/.well-known.txt",b"portable"),
        ("content/module.version.js",b"portable"),
    ])
if mode=="development_popup":
    rows.append(("popup.html",b'<html><script src="popup.js"></script></html>'))
    rows.append(("popup.js","console.log('Локальная разработка')".encode()))
if mode in ("import_whitespace", "import_no_semicolon", "import_comment", "import_unicode_escape", "import_bracket"):
    rows.append(("dev.js",b"/* LOCAL DEVELOPMENT */"))
if mode=="symlink":
    with zipfile.ZipFile(path,"w") as z:
        i=zipfile.ZipInfo("link")
        i.create_system=3
        i.external_attr=(0o120777<<16)
        z.writestr(i,b"target")
    raise SystemExit(0)
def crc_suffix(prefix,target):
    zero=zlib.crc32(prefix+bytes(4))
    pivots={}
    for bit in range(32):
        value=bytearray(4)
        value[bit//8]=1<<(bit%8)
        delta=zlib.crc32(prefix+bytes(value))^zero
        mask=1<<bit
        while delta:
            high=delta.bit_length()-1
            if high not in pivots:
                pivots[high]=(delta,mask)
                break
            stored_delta,stored_mask=pivots[high]
            delta^=stored_delta
            mask^=stored_mask
    remainder=target^zero
    solution=0
    while remainder:
        high=remainder.bit_length()-1
        delta,mask=pivots[high]
        remainder^=delta
        solution^=mask
    result=solution.to_bytes(4,"little")
    assert zlib.crc32(prefix+result)==target
    return result

if mode.startswith("zip_stream_"):
    if mode in ("zip_stream_crc_signature_collision","zip_stream_crc_collision_gap"):
        for nonce in range(10000):
            prefix=worker+bytes((10,))+b"//C01_SIGNATURE_CRC_"+str(nonce).encode()+b":"
            suffix=crc_suffix(prefix,0x08074b50)
            if all(33<=ch<=126 for ch in suffix):
                worker=prefix+suffix
                break
        else:
            raise AssertionError("No printable CRC collision suffix")
        rows[1]=("worker.js",worker)
    class WriteOnly:
        def __init__(self, sink): self.sink=sink
        def write(self, value): return self.sink.write(value)
        def flush(self): return self.sink.flush()
        def tell(self): return self.sink.tell()
        def seek(self, *args): raise io.UnsupportedOperation("nonseekable")
    with open(path,"wb") as sink:
        with zipfile.ZipFile(WriteOnly(sink),"w",compression=zipfile.ZIP_DEFLATED) as z:
            for name,value in rows:
                z.writestr(name,value)
    if mode!="zip_stream_descriptor":
        with open(path,"rb") as source:
            blob=bytearray(source.read())
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            first=archive.infolist()[0]
            last=archive.infolist()[-1]
        if mode=="zip_stream_partial_local_header":
            assert first.CRC!=0
            struct.pack_into("<I",blob,first.header_offset+14,first.CRC)
        else:
            name_size,extra_size=struct.unpack_from("<HH",blob,last.header_offset+26)
            descriptor=last.header_offset+30+name_size+extra_size+last.compress_size
            assert blob[descriptor:descriptor+4]==bytes((80,75,7,8))
            if mode=="zip_stream_unsigned_descriptor":
                del blob[descriptor:descriptor+4]
                eocd=blob.rfind(bytes((80,75,5,6)))
                central=struct.unpack_from("<I",blob,eocd+16)[0]
                struct.pack_into("<I",blob,eocd+16,central-4)
            if mode=="zip_stream_crc_collision_gap":
                assert last.CRC==0x08074b50
                extra=b"C01_NONPRIVATE_DESCRIPTOR_LOCAL_GAP"
                blob[descriptor+16:descriptor+16]=extra
                eocd=blob.rfind(bytes((80,75,5,6)))
                central=struct.unpack_from("<I",blob,eocd+16)[0]
                struct.pack_into("<I",blob,eocd+16,central+len(extra))
        with open(path,"wb") as target:
            target.write(blob)
    raise SystemExit(0)
if mode=="zip_opaque_prefix":
    with open(path,"wb") as sink:
        sink.write(b"C01_NONPRIVATE_UNCHECKED_PREAMBLE")
with zipfile.ZipFile(path,"a" if mode=="zip_opaque_prefix" else "w",
        compression=zipfile.ZIP_DEFLATED if mode in ("zip_gpbf_deflate_options","zip_deflate_unused_tail") else zipfile.ZIP_STORED) as z:
    for index,(name,value) in enumerate(rows):
        if mode=="zip_opaque_local_gap" and index==1:
            z.fp.write(b"C01_NONPRIVATE_UNCHECKED_LOCAL_GAP")
            z.start_dir=z.fp.tell()
        if mode=="dos_directory_for_file" and name=="worker.js":
            info=zipfile.ZipInfo(name)
            info.create_system=0
            info.external_attr=0x10
            z.writestr(info,value)
        elif mode=="unix_low_directory_bit_regular_file" and name=="worker.js":
            info=zipfile.ZipInfo(name)
            info.create_system=3
            info.external_attr=(0o100644<<16)|0x10
            z.writestr(info,value)
        elif mode=="unix_directory_for_file" and name=="worker.js":
            info=zipfile.ZipInfo(name)
            info.create_system=3
            info.external_attr=(0o040755<<16)
            z.writestr(info,value)
        elif mode=="zip_entry_comment" and name=="worker.js":
            info=zipfile.ZipInfo(name)
            info.comment=b"C01_NONPRIVATE_HIDDEN_ENTRY_COMMENT"
            z.writestr(info,value)
        elif mode=="zip_entry_extra" and name=="worker.js":
            info=zipfile.ZipInfo(name)
            info.extra=bytes((239,190,4,0))+b"FAKE"
            z.writestr(info,value)
        else:
            z.writestr(name,value)
    if mode=="unix_file_for_directory":
        info=zipfile.ZipInfo("fakedir/")
        info.create_system=3
        info.external_attr=(0o100644<<16)
        z.writestr(info,b"")
    if mode=="zip_comment":
        z.comment=b"C01_NONPRIVATE_OPAQUE_COMMENT"
if mode in ("zip_gpbf_reserved_bit14", "zip_gpbf_strong_encryption_bit6", "zip_gpbf_deflate_options"):
    with open(path,"rb") as source:
        payload=bytearray(source.read())
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        target=archive.getinfo("worker.js")
        local_offset=target.header_offset
        assert target.compress_type==(zipfile.ZIP_DEFLATED if mode=="zip_gpbf_deflate_options" else zipfile.ZIP_STORED)
    eocd=payload.rfind(bytes((80,75,5,6)))
    assert eocd>=0
    directory=struct.unpack_from("<I",payload,eocd+16)[0]
    count=struct.unpack_from("<H",payload,eocd+10)[0]
    target_central=None
    for _ in range(count):
        assert payload[directory:directory+4]==bytes((80,75,1,2))
        n,e,c=struct.unpack_from("<HHH",payload,directory+28)
        label=payload[directory+46:directory+46+n]
        if label==b"worker.js":target_central=directory
        directory+=46+n+e+c
    assert target_central is not None and directory==eocd
    flag={"zip_gpbf_reserved_bit14":1<<14,
          "zip_gpbf_strong_encryption_bit6":1<<6,
          "zip_gpbf_deflate_options":6}[mode]
    # Deliberately alter *both* local and central records, avoiding the
    # pre-existing mismatch check so this exercises unsupported GPBF semantics.
    struct.pack_into("<H",payload,local_offset+6,flag)
    struct.pack_into("<H",payload,target_central+8,flag)
    with open(path,"wb") as sink:
        sink.write(payload)
if mode=="zip_deflate_unused_tail":
    with open(path,"rb") as source:
        payload=bytearray(source.read())
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        worker=archive.getinfo("worker.js")
        assert worker.compress_type==zipfile.ZIP_DEFLATED
        local_offset=worker.header_offset
        original_compressed_size=worker.compress_size
    local_name_length,local_extra_length=struct.unpack_from("<HH",payload,local_offset+26)
    end_of_deflate=local_offset+30+local_name_length+local_extra_length+original_compressed_size
    eocd=payload.rfind(bytes((80,75,5,6)))
    assert eocd>=0
    central=struct.unpack_from("<I",payload,eocd+16)[0]
    count=struct.unpack_from("<H",payload,eocd+10)[0]
    assert end_of_deflate==central and count==2
    directory=central
    worker_directory=None
    for _ in range(count):
        assert payload[directory:directory+4]==bytes((80,75,1,2))
        n,e,c=struct.unpack_from("<HHH",payload,directory+28)
        if payload[directory+46:directory+46+n]==b"worker.js":
            worker_directory=directory
        directory+=46+n+e+c
    assert directory==eocd and worker_directory is not None
    # A well-formed compressed entry can have an opaque tail after the
    # end-of-deflate marker. Neither CRC nor raw-size checks account for it.
    extra=b"C01_BENIGN_UNUSED_DEFLATE_BYTES_"*3
    payload[central:central]=extra
    central_after=central+len(extra)
    eocd_after=eocd+len(extra)
    worker_directory_after=worker_directory+len(extra)
    struct.pack_into("<I",payload,local_offset+18,original_compressed_size+len(extra))
    struct.pack_into("<I",payload,worker_directory_after+20,original_compressed_size+len(extra))
    struct.pack_into("<I",payload,eocd_after+16,central_after)
    with zipfile.ZipFile(io.BytesIO(payload)) as verified:
        assert verified.testzip() is None
    with open(path,"wb") as sink:
        sink.write(payload)
if mode=="zip_directory_gap":
    with open(path,"rb") as handle:
        raw=handle.read()
    assert raw[-22:-18]==bytes((80,75,5,6))
    with open(path,"wb") as handle:
        handle.write(raw[:-22]+b"C01_NONPRIVATE_OPAQUE_GAP"+raw[-22:])
if mode=="zip_local_crc_mismatch":
    with open(path,"r+b") as handle:
        handle.seek(14)
        old=struct.unpack("<I",handle.read(4))[0]
        handle.seek(14)
        handle.write(struct.pack("<I",old^1))
if mode=="zip_local_extra_only":
    with open(path,"rb") as handle:
        raw=bytearray(handle.read())
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        worker_info=archive.getinfo("worker.js")
    position=worker_info.header_offset
    name_size,extra_size=struct.unpack_from("<HH",raw,position+26)
    local_data_start=position+30+name_size+extra_size
    extra=bytes((239,190,4,0))+b"FAKE"
    raw[local_data_start:local_data_start]=extra
    struct.pack_into("<H",raw,position+28,extra_size+len(extra))
    eocd=raw.rfind(bytes((80,75,5,6)))
    old_central_start=struct.unpack_from("<I",raw,eocd+16)[0]
    struct.pack_into("<I",raw,eocd+16,old_central_start+len(extra))
    with open(path,"wb") as handle:
        handle.write(raw)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
`;

function encode(value) {
  return Buffer.from(value).toString("base64");
}

function makeZip(path, browser, options = {}) {
  const authority = options.authority ?? releaseAuthority();
  let manifest = {
    manifest_version: 3,
    version: options.version ?? authority.productVersion,
    host_permissions: [
      `${authority.origins.controlApiOrigin}/*`,
      `${authority.origins.portalOrigin}/*`,
    ],
    background:
      browser === "chromium"
        ? { service_worker: "worker.js" }
        : { scripts: ["worker.js"] },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: { id: options.firefoxId ?? FIREFOX_STORE_ID },
          },
        }
      : {}),
  };

  if (
    [
      "missing_declared_icon",
      "short_declared_icon",
      "valid_declared_icon",
      "unsafe_declared_icon",
      "unknown_critical_png",
      "nonconsecutive_idat_png",
      "png_highbit_ihdr",
      "png_trailing_idat",
      "png_invalid_trns_rgba",
      "png_metadata_text",
      "png_consecutive_idat",
      "png_bkgd_after_idat",
      "png_bad_bkgd_length",
    ].includes(options.mode)
  ) {
    manifest.icons = {
      16:
        options.mode === "unsafe_declared_icon"
          ? "../outside.png"
          : "icons/icon-16.png",
    };
    manifest.action = { default_icon: { 16: "icons/icon-16.png" } };
  }
  if (options.mode === "missing_default_icon") {
    manifest.action = { default_icon: { 16: "icons/icon-16.png" } };
  }
  if (options.mode === "not_extension") {
    manifest = { fake: "manifest" };
  }
  if (options.mode === "wrong_endpoint") {
    manifest.host_permissions = [
      "https://replaced.invalid/*",
      `${authority.origins.portalOrigin}/*`,
    ];
  }
  if (options.mode === "development_popup") {
    manifest.action = { default_popup: "popup.html" };
  }
  if (options.mode === "module_background") {
    manifest.background = { service_worker: "worker.js", type: "module" };
  }

  let config = packagedConfig(authority);
  if (options.mode === "attacker_key") {
    config = { ...config, trustBundle: attackerBundle };
  }
  if (options.mode === "wrong_contract") {
    config = { ...config, contractVersion: "control_plane_v1" };
  }
  if (options.mode === "wrong_environment") {
    config = { ...config, environment: "ANOTHER_ENVIRONMENT" };
  }

  let worker =
    options.mode === "missing_config"
      ? "console.log('runtime');\n"
      : `globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=${JSON.stringify(
          JSON.stringify(config),
        )};\n`;
  if (options.mode === "config_only_comment") {
    worker = "// " + worker;
  }
  if (options.mode === "config_only_block_comment") {
    worker = "/*\n" + worker + "*/\n";
  }
  if (options.mode === "config_only_template") {
    worker = "const note = `" + worker + "`;\n";
  }
  if (options.mode === "development_material") {
    worker +=
      "/* LOCAL DEVELOPMENT http://127.0.0.1:43100 http://127.0.0.1:43101 config-local-development */\n";
  }
  if (options.mode === "import_whitespace") {
    worker += 'importScripts ("dev.js");\n';
  }
  if (options.mode === "import_no_semicolon") {
    worker += 'importScripts("dev.js")\n';
  }
  if (options.mode === "import_comment") {
    worker += 'importScripts/*comment*/("dev.js");\n';
  }
  if (options.mode === "import_unicode_escape") {
    worker += 'import\\u0053cripts("dev.js");\n';
  }
  if (options.mode === "import_bracket") {
    worker += 'globalThis["importScripts"]("dev.js");\n';
  }

  const result = spawnSync(
    "python3",
    [
      "-c",
      ZIP_WRITER,
      path,
      browser,
      options.mode ?? "",
      encode(JSON.stringify(manifest)),
      encode(worker),
      encode(
        readFileSync(resolve("apps/extension/src/assets/octoport-16.png")),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "octoport-c01-"));
  const candidate = join(root, "source-packages");
  mkdirSync(candidate);

  const authorityValue = releaseAuthority(options.authority ?? {});
  const authority = join(root, "release-authority.json");
  writeFileSync(authority, JSON.stringify(authorityValue));

  const packageAuthority = options.packageAuthority ?? authorityValue;
  makeZip(join(candidate, "chromium.zip"), "chromium", {
    ...(options.chromium ?? {}),
    authority: packageAuthority,
  });
  makeZip(join(candidate, "firefox.zip"), "firefox", {
    ...(options.firefox ?? {}),
    authority: packageAuthority,
  });

  return {
    root,
    candidate,
    authority,
    authorityValue,
  };
}

function cleanup(value) {
  rmSync(value.root, { force: true, recursive: true });
}

function prepare(value) {
  const output = join(value.root, "prepared");
  const result = prepareCandidate({
    authorityPath: value.authority,
    outputDir: output,
    chromium: join(value.candidate, "chromium.zip"),
    firefox: join(value.candidate, "firefox.zip"),
  });
  return { output, result };
}

function preflight(value, candidateDir) {
  return validateCandidate({
    authorityPath: value.authority,
    candidateDir,
  });
}

function expectPrepareFailure(name, browserMode, expectedFailure) {
  test(name, () => {
    const value = fixture({
      chromium: { mode: browserMode },
    });
    try {
      assert.throws(() => prepare(value), expectedFailure);
    } finally {
      cleanup(value);
    }
  });
}

test("repository release facts use current contract/version/migration tag", () => {
  const facts = productFacts();
  assert.equal(facts.productVersion, "0.2.30");
  assert.equal(facts.contractVersion, "control_plane_v2");
  assert.equal(facts.migrationLevel, 61);
});

test("correct synthetic Chromium and Firefox candidate prepares and passes", () => {
  const value = fixture();
  try {
    const { output, result } = prepare(value);
    assert.equal(result.productVersion, productFacts().productVersion);
    const rc = JSON.parse(
      readFileSync(join(output, "B1_RC_MANIFEST.json"), "utf8"),
    );
    for (const browser of ["chromium", "firefox"]) {
      const archive = readFileSync(join(value.candidate, `${browser}.zip`));
      assert.equal(rc.packages[browser].bytes, archive.length);
      assert.equal(
        rc.packages[browser].sha256,
        createHash("sha256").update(archive).digest("hex"),
      );
      assert.equal(rc.packages[browser].inventoryCount, 2);
    }
    const result2 = preflight(value, output);
    assert.equal(result2.status, "PASS");
    assert.equal(result2.evidenceLevel, "PACKAGE");
    assert.equal(result2.productionMutation, "NOT_PERFORMED");
    assert.equal(result2.externalAcceptance, "NOT_CLAIMED");
  } finally {
    cleanup(value);
  }
});

test("CLI preparer and preflight emit machine-readable bounded success", () => {
  const value = fixture();
  try {
    const output = join(value.root, "prepared");
    const prepared = spawnSync(
      NODE,
      [
        prepareTool,
        "--authority",
        value.authority,
        "--out",
        output,
        "--chromium",
        join(value.candidate, "chromium.zip"),
        "--firefox",
        join(value.candidate, "firefox.zip"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const preparedJson = JSON.parse(prepared.stdout);
    assert.equal(preparedJson.status, "PREPARED");
    assert.equal(preparedJson.productionMutation, "NOT_PERFORMED");
    assert.equal(preparedJson.externalAcceptance, "NOT_CLAIMED");

    const checked = spawnSync(
      NODE,
      [preflightTool, output, "--authority", value.authority],
      { encoding: "utf8" },
    );
    assert.equal(checked.status, 0, checked.stderr);
    const checkedJson = JSON.parse(checked.stdout);
    assert.equal(checkedJson.status, "PASS");
    assert.equal(checkedJson.evidenceLevel, "PACKAGE");
    assert.equal(checkedJson.productionMutation, "NOT_PERFORMED");
  } finally {
    cleanup(value);
  }
});

test("NOT_AN_EXTENSION never becomes release PASS", () => {
  const value = fixture({
    chromium: { mode: "not_extension" },
  });
  try {
    assert.throws(() => prepare(value));
  } finally {
    cleanup(value);
  }
});

test("PRODUCTION authority is rejected in PREPRODUCTION store-review lane", () => {
  const value = fixture({ authority: { environment: "PRODUCTION" } });
  try {
    assert.throws(() => prepare(value), /Invalid authority schema/);
  } finally {
    cleanup(value);
  }
});

test("Chromium module service worker is rejected until C01 has an ESM dependency validator", () => {
  const value = fixture({
    chromium: { mode: "module_background" },
  });
  try {
    assert.throws(
      () => prepare(value),
      /Chromium module service worker is not accepted/,
    );
  } finally {
    cleanup(value);
  }
});

test("non-canonical classic importScripts whitespace form is rejected fail-closed", () => {
  const value = fixture({
    chromium: { mode: "import_whitespace" },
  });
  try {
    assert.throws(() => prepare(value), /unsupported importScripts syntax/);
  } finally {
    cleanup(value);
  }
});

test("non-canonical classic importScripts without semicolon is rejected fail-closed", () => {
  const value = fixture({
    chromium: { mode: "import_no_semicolon" },
  });
  try {
    assert.throws(() => prepare(value), /unsupported importScripts syntax/);
  } finally {
    cleanup(value);
  }
});

test("comment-obfuscated classic importScripts is rejected fail-closed", () => {
  const value = fixture({
    chromium: { mode: "import_comment" },
  });
  try {
    assert.throws(() => prepare(value), /unsupported importScripts syntax/);
  } finally {
    cleanup(value);
  }
});

test("Unicode-escaped importScripts identifier is rejected fail-closed", () => {
  const value = fixture({
    chromium: { mode: "import_unicode_escape" },
  });
  try {
    assert.throws(() => prepare(value), /escaped importScripts identifier/);
  } finally {
    cleanup(value);
  }
});

test("bracket-notation importScripts access is rejected fail-closed", () => {
  const value = fixture({
    chromium: { mode: "import_bracket" },
  });
  try {
    assert.throws(() => prepare(value), /unsupported importScripts syntax/);
  } finally {
    cleanup(value);
  }
});

test("package background containing development-only material is rejected", () => {
  const value = fixture({
    chromium: { mode: "development_material" },
  });
  try {
    assert.throws(
      () => prepare(value),
      /background contains development-only material/,
    );
  } finally {
    cleanup(value);
  }
});

test("package popup containing development-only material is rejected", () => {
  const value = fixture({
    chromium: { mode: "development_popup" },
  });
  try {
    assert.throws(
      () => prepare(value),
      /popup surface contains development-only material/,
    );
  } finally {
    cleanup(value);
  }
});

test("Firefox package with a different stable add-on ID is rejected", () => {
  const value = fixture({
    firefox: { firefoxId: "different@octoport.ru" },
  });
  try {
    assert.throws(
      () => prepare(value),
      /Firefox package stable extension ID mismatch/,
    );
  } finally {
    cleanup(value);
  }
});

test("package carrying arbitrary bootstrap trust is rejected", () => {
  const value = fixture({
    chromium: { mode: "attacker_key" },
  });
  try {
    assert.throws(() => prepare(value), /trust bundle/i);
  } finally {
    cleanup(value);
  }
});

test("authority public-key fingerprint must be cryptographically consistent", () => {
  const broken = {
    ...trustedBundle,
    keys: trustedBundle.keys.map((key) => ({ ...key })),
  };
  broken.keys[0].fingerprintSha256 = "0".repeat(64);
  const value = fixture({
    authority: { trustBundle: broken },
  });
  try {
    assert.throws(() => prepare(value), /fingerprint/i);
  } finally {
    cleanup(value);
  }
});

expectPrepareFailure("ZIP traversal is rejected", "path");
expectPrepareFailure("absolute ZIP path is rejected", "absolute");
expectPrepareFailure("backslash ZIP escape is rejected", "backslash");
for (const [name, mode] of [
  ["Windows ZIP alternate-data-stream colon is rejected", "windows_unsafe_ads"],
  ["Windows ZIP reserved device AUX is rejected", "windows_unsafe_reserved"],
  ["Windows ZIP nested device NUL is rejected", "windows_unsafe_child_device"],
  [
    "Windows ZIP superscript device COM¹ is rejected",
    "windows_unsafe_unicode_device",
  ],
  ["Windows ZIP trailing dot is rejected", "windows_unsafe_trailing_dot"],
  ["Windows ZIP trailing space is rejected", "windows_unsafe_trailing_space"],
  ["Windows ZIP wildcard is rejected", "windows_unsafe_wildcard"],
  ["Windows ZIP control character is rejected", "windows_unsafe_control"],
  [
    "Windows ZIP non-ASCII composed filename is rejected",
    "windows_unsafe_nonascii_composed",
  ],
  [
    "Windows ZIP non-ASCII decomposed filename is rejected",
    "windows_unsafe_nonascii_decomposed",
  ],
  [
    "Windows ZIP non-ASCII compatibility case filename is rejected",
    "windows_unsafe_nonascii_kelvin",
  ],
  ["Windows ZIP console device CONIN$ is rejected", "windows_unsafe_conin"],
  ["Windows ZIP console device CONOUT$ is rejected", "windows_unsafe_conout"],
  [
    "Windows ZIP nested CONOUT$ directory is rejected",
    "windows_unsafe_conout_directory",
  ],
  ["Windows ZIP COM0 device alias is rejected", "windows_unsafe_com0"],
  ["Windows ZIP LPT0 device alias is rejected", "windows_unsafe_lpt0"],
]) {
  expectPrepareFailure(name, mode, /Unsafe ZIP path/);
}
expectPrepareFailure(
  "Windows ZIP nested ASCII case alias is rejected",
  "windows_case_alias",
  /Duplicate ZIP entry/,
);
test("portable Windows ZIP near-device filenames remain accepted", () => {
  const value = fixture({ chromium: { mode: "windows_portable_names" } });
  try {
    const { output } = prepare(value);
    preflight(value, output);
  } finally {
    cleanup(value);
  }
});
expectPrepareFailure("duplicate ZIP entry is rejected", "duplicate");
expectPrepareFailure(
  "case-folded duplicate ZIP entry is rejected",
  "case_duplicate",
);
for (const [name, mode] of [
  [
    "ZIP file ancestor before descendant is rejected",
    "prefix_file_before_child",
  ],
  [
    "ZIP descendant before file ancestor is rejected",
    "prefix_child_before_file",
  ],
  [
    "ZIP explicit directory before file is rejected",
    "prefix_directory_then_file",
  ],
  [
    "ZIP file before explicit directory is rejected",
    "prefix_file_then_directory",
  ],
  ["ZIP mixed-case file ancestor is rejected", "prefix_mixed_case"],
]) {
  expectPrepareFailure(name, mode, /ZIP path hierarchy collision/);
}
expectPrepareFailure(
  "ZIP excessive ancestor depth is rejected before hierarchy allocation",
  "prefix_depth_excess",
  /Unsafe ZIP path/,
);
for (const [name, mode] of [
  [
    "ZIP real directory before descendant stays valid",
    "prefix_valid_parent_first",
  ],
  [
    "ZIP real directory after descendant stays valid",
    "prefix_valid_parent_last",
  ],
  ["ZIP bounded maximum path depth stays valid", "prefix_depth_limit"],
]) {
  test(name, () => {
    const value = fixture({ chromium: { mode } });
    try {
      const { output } = prepare(value);
      assert.equal(preflight(value, output).status, "PASS");
    } finally {
      cleanup(value);
    }
  });
}
test("ZIP hierarchy stays within 64 MiB JS heap for 128 distinct deep paths", () => {
  const value = fixture({ chromium: { mode: "prefix_deep_fanout_128" } });
  try {
    const reader = pathToFileURL(resolve("tooling/b1/release-lib.mjs")).href;
    const script = [
      'import { readFileSync } from "node:fs";',
      "import { readZip } from " + JSON.stringify(reader) + ";",
      "const entries = readZip(readFileSync(process.argv[1]));",
      'if (entries.size !== 130) throw Error("Unexpected ZIP entry count");',
      "console.log(entries.size);",
    ].join("\n");
    const result = spawnSync(
      NODE,
      [
        "--max-old-space-size=64",
        "--input-type=module",
        "-e",
        script,
        join(value.candidate, "chromium.zip"),
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 },
    );
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stdout.trim(), "130");
  } finally {
    cleanup(value);
  }
});
expectPrepareFailure(
  "missing declared extension runtime is rejected",
  "no_runtime",
);
expectPrepareFailure(
  "declared icon missing from both browser ZIPs is rejected",
  "missing_declared_icon",
  /Declared icon resource missing/,
);
expectPrepareFailure(
  "declared 16-pixel RGBA icon with truncated rows is rejected",
  "short_declared_icon",
  /PNG icon pixel data invalid/,
);
expectPrepareFailure(
  "unsafe declared icon path is rejected before member lookup",
  "unsafe_declared_icon",
  /Declared icon path invalid/,
);
expectPrepareFailure(
  "missing action default_icon resource is rejected",
  "missing_default_icon",
  /Declared icon resource missing/,
);
expectPrepareFailure(
  "PNG unknown critical chunk with valid CRC is rejected",
  "unknown_critical_png",
  /PNG icon unsupported critical chunk/,
);
expectPrepareFailure(
  "PNG nonconsecutive IDAT separated by tEXt is rejected",
  "nonconsecutive_idat_png",
  /PNG icon unsupported chunk/,
);
for (const [mode, title, failure] of [
  [
    "png_highbit_ihdr",
    "PNG non-ASCII high-bit chunk name cannot alias IHDR",
    /PNG icon chunk type invalid/,
  ],
  [
    "png_trailing_idat",
    "PNG IDAT zlib trailing bytes cannot be ignored",
    /PNG icon compressed stream contains trailing bytes/,
  ],
]) {
  for (const browser of ["chromium", "firefox"]) {
    test(browser + ": " + title, () => {
      const value = fixture({ [browser]: { mode } });
      try {
        assert.throws(() => prepare(value), failure);
      } finally {
        cleanup(value);
      }
    });
  }
}
for (const [mode, title, failure] of [
  [
    "png_invalid_trns_rgba",
    "PNG RGBA rejects tRNS after IDAT",
    /PNG icon unsupported chunk/,
  ],
  [
    "png_metadata_text",
    "canonical PNG icon rejects additional tEXt metadata",
    /PNG icon unsupported chunk/,
  ],
  [
    "png_bkgd_after_idat",
    "PNG canonical background chunk before IDAT only",
    /PNG icon background metadata invalid/,
  ],
  [
    "png_bad_bkgd_length",
    "PNG background metadata must contain RGB sample bytes",
    /PNG icon background metadata invalid/,
  ],
]) {
  for (const browser of ["chromium", "firefox"]) {
    test(browser + ": " + title, () => {
      const value = fixture({ [browser]: { mode } });
      try {
        assert.throws(() => prepare(value), failure);
      } finally {
        cleanup(value);
      }
    });
  }
}
test("valid two-consecutive-IDAT PNG remains accepted in both browser families", () => {
  const value = fixture({
    chromium: { mode: "png_consecutive_idat" },
    firefox: { mode: "png_consecutive_idat" },
  });
  try {
    const { output } = prepare(value);
    assert.equal(preflight(value, output).status, "PASS");
  } finally {
    cleanup(value);
  }
});
test("valid declared Chromium and Firefox icon remains accepted", () => {
  const value = fixture({
    chromium: { mode: "valid_declared_icon" },
    firefox: { mode: "valid_declared_icon" },
  });
  try {
    const { output } = prepare(value);
    assert.equal(preflight(value, output).status, "PASS");
  } finally {
    cleanup(value);
  }
});
expectPrepareFailure("private-key material is rejected", "secret");
expectPrepareFailure("forbidden secret file is rejected", "secretfile");
expectPrepareFailure(
  "ZIP DOS directory attribute on regular file path is rejected",
  "dos_directory_for_file",
  /ZIP DOS directory attribute\/path mismatch/,
);
test("Unix-created regular ZIP file with low attribute bit 0x10 is valid", () => {
  const value = fixture({
    chromium: { mode: "unix_low_directory_bit_regular_file" },
  });
  try {
    const { output } = prepare(value);
    assert.equal(preflight(value, output).status, "PASS");
  } finally {
    cleanup(value);
  }
});
expectPrepareFailure(
  "ZIP Unix directory mode on regular file path is rejected",
  "unix_directory_for_file",
);
expectPrepareFailure(
  "ZIP Unix regular-file mode on directory path is rejected",
  "unix_file_for_directory",
);
expectPrepareFailure(
  "unconsumed bytes after deflate stream are rejected",
  "zip_deflate_unused_tail",
);
expectPrepareFailure(
  "reserved ZIP general-purpose flag bit14 is rejected",
  "zip_gpbf_reserved_bit14",
);
expectPrepareFailure(
  "strong-encryption ZIP general-purpose flag bit6 is rejected",
  "zip_gpbf_strong_encryption_bit6",
);
test("supported deflate compression-option flag bits remain readable", () => {
  const value = fixture({ chromium: { mode: "zip_gpbf_deflate_options" } });
  try {
    assert.doesNotThrow(() => prepare(value));
  } finally {
    cleanup(value);
  }
});
expectPrepareFailure("opaque ZIP comment is rejected", "zip_comment");
expectPrepareFailure(
  "unaccounted ZIP central directory gap is rejected",
  "zip_directory_gap",
);
expectPrepareFailure(
  "opaque ZIP local preamble is rejected",
  "zip_opaque_prefix",
);
expectPrepareFailure(
  "opaque ZIP local gap is rejected",
  "zip_opaque_local_gap",
);
expectPrepareFailure(
  "ZIP local and central CRC mismatch is rejected",
  "zip_local_crc_mismatch",
);
for (const mode of [
  "zip_stream_descriptor",
  "zip_stream_unsigned_descriptor",
  "zip_stream_crc_signature_collision",
]) {
  test("valid ZIP streaming descriptor remains supported: " + mode, () => {
    const value = fixture({ chromium: { mode } });
    try {
      assert.doesNotThrow(() => prepare(value));
    } finally {
      cleanup(value);
    }
  });
}
expectPrepareFailure(
  "mixed populated and zero streaming ZIP local fields are rejected",
  "zip_stream_partial_local_header",
);
expectPrepareFailure(
  "CRC signature collision with hidden descriptor gap is rejected",
  "zip_stream_crc_collision_gap",
);
expectPrepareFailure(
  "opaque ZIP per-entry comment is rejected",
  "zip_entry_comment",
);
expectPrepareFailure(
  "opaque ZIP central and local extra metadata is rejected",
  "zip_entry_extra",
);
expectPrepareFailure(
  "opaque ZIP local-only extra metadata is rejected",
  "zip_local_extra_only",
);
expectPrepareFailure("symlink-like ZIP entry is rejected", "symlink");

test("oversized package input is rejected before archive allocation", () => {
  const value = fixture();
  try {
    const oversized = join(value.root, "oversized.zip");
    writeFileSync(oversized, "");
    truncateSync(oversized, 128 * 1024 * 1024 + 1);
    assert.throws(
      () =>
        prepareCandidate({
          authorityPath: value.authority,
          outputDir: join(value.root, "oversized-output"),
          chromium: oversized,
          firefox: join(value.candidate, "firefox.zip"),
        }),
      /size limit/i,
    );
  } finally {
    cleanup(value);
  }
});

test("non-regular package input is rejected before archive read", () => {
  const value = fixture();
  try {
    const directoryInput = join(value.root, "directory.zip");
    mkdirSync(directoryInput);
    assert.throws(
      () =>
        prepareCandidate({
          authorityPath: value.authority,
          outputDir: join(value.root, "directory-output"),
          chromium: directoryInput,
          firefox: join(value.candidate, "firefox.zip"),
        }),
      /regular file/i,
    );
  } finally {
    cleanup(value);
  }
});

expectPrepareFailure(
  "missing reachable packaged config is rejected",
  "missing_config",
);
expectPrepareFailure(
  "commented packaged configuration cannot substitute a runtime assignment",
  "config_only_comment",
  /reachable packaged config/,
);
expectPrepareFailure(
  "block-comment packaged configuration cannot substitute a runtime assignment",
  "config_only_block_comment",
  /reachable packaged config/,
);
expectPrepareFailure(
  "template-literal packaged configuration cannot substitute a runtime assignment",
  "config_only_template",
  /reachable packaged config/,
);
expectPrepareFailure("stale packaged contract is rejected", "wrong_contract");
expectPrepareFailure(
  "replaced packaged endpoint is rejected",
  "wrong_endpoint",
);
expectPrepareFailure(
  "mismatched packaged environment is rejected",
  "wrong_environment",
);

for (const [name, authorityPatch] of [
  [
    "stale source HEAD fails",
    {
      source: {
        head: "0".repeat(40),
        tree: sourceIdentity().tree,
      },
    },
  ],
  [
    "stale source tree fails",
    {
      source: {
        head: sourceIdentity().head,
        tree: "0".repeat(40),
      },
    },
  ],
  ["stale product version fails", { productVersion: "0.0.0" }],
  ["stale server contract fails", { contractVersion: "old_contract" }],
  ["stale migration level fails", { migrationLevel: 999 }],
]) {
  test(name, () => {
    const value = fixture({ authority: authorityPatch });
    try {
      assert.throws(() => prepare(value), /stale/i);
    } finally {
      cleanup(value);
    }
  });
}

test("authority origins cannot be replaced without matching package evidence", () => {
  const baseline = releaseAuthority();
  const value = fixture({
    authority: {
      origins: {
        controlApiOrigin: "https://replacement-api.fixture.invalid",
        portalOrigin: "https://replacement-app.fixture.invalid",
      },
    },
    packageAuthority: baseline,
  });
  try {
    assert.throws(() => prepare(value), /endpoint|authority/i);
  } finally {
    cleanup(value);
  }
});

test("authority exact bytes are bound into the candidate manifest", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    writeFileSync(
      value.authority,
      JSON.stringify(value.authorityValue, null, 2) + "\n",
    );
    assert.throws(() => preflight(value, output), /authority|stale/i);
  } finally {
    cleanup(value);
  }
});

test("candidate package filename cannot escape candidate directory", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const manifestPath = join(output, "B1_RC_MANIFEST.json");
    const rc = JSON.parse(readFileSync(manifestPath, "utf8"));
    rc.packages.chromium.filename = "../chromium.zip";
    writeFileSync(manifestPath, JSON.stringify(rc));
    assert.throws(() => preflight(value, output), /package metadata/i);
  } finally {
    cleanup(value);
  }
});

test("candidate metadata cannot replace archive hash facts", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const manifestPath = join(output, "B1_RC_MANIFEST.json");
    const rc = JSON.parse(readFileSync(manifestPath, "utf8"));
    rc.packages.chromium.sha256 = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(rc));
    assert.throws(() => preflight(value, output), /archive bytes/i);
  } finally {
    cleanup(value);
  }
});

test("authority must be external to prepared candidate directory", () => {
  const value = fixture();
  try {
    const { output } = prepare(value);
    const insideAuthority = join(output, "authority.json");
    writeFileSync(insideAuthority, readFileSync(value.authority));
    assert.throws(
      () =>
        validateCandidate({
          authorityPath: insideAuthority,
          candidateDir: output,
        }),
      /outside/i,
    );
  } finally {
    cleanup(value);
  }
});

test("preparer never claims browser/live/deployment acceptance", () => {
  const value = fixture();
  try {
    const output = join(value.root, "prepared");
    const result = spawnSync(
      NODE,
      [
        prepareTool,
        "--authority",
        value.authority,
        "--out",
        output,
        "--chromium",
        join(value.candidate, "chromium.zip"),
        "--firefox",
        join(value.candidate, "firefox.zip"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stdout,
      /LIVE_OWNER|BROWSER_ACCEPTED|DEPLOYED|PRODUCTION_PASS/,
    );
    assert.match(result.stdout, /"productionMutation":"NOT_PERFORMED"/);
    assert.match(result.stdout, /"externalAcceptance":"NOT_CLAIMED"/);
  } finally {
    cleanup(value);
  }
});
