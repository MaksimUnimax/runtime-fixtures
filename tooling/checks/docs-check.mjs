import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function checkDocumentation(files, repositoryPaths = Object.keys(files)) {
  const errors = [];
  const paths = Object.keys(files).sort();
  // Link existence concerns every regular repository file. Content checks below
  // intentionally remain limited to documentation/text formats, not binary assets.
  const targets = [...new Set([...repositoryPaths, ...paths])];
  const targetSet = new Set(targets);
  const required = [
    "README.md", "AGENTS.md", "docs/README.md", "docs/STATUS.md", "docs/ROADMAP.md",
    "docs/product/SPEC.md", "docs/product/UX.md", "docs/product/BETA_ADMISSION.md",
    "docs/architecture/SYNC.md", "docs/architecture/CONTRACTS.md",
    "docs/development/ACCEPTANCE_MATRIX.md", "docs/migration/SOURCES.md",
    "docs/migration/PLAN.md", "docs/migration/evidence/DOCUMENTATION_ACCEPTANCE.md",
    ".github/workflows/documentation.yml", "package.json", "pnpm-workspace.yaml"
  ];
  for (const p of required) if (!(p in files)) errors.push("Missing required file: " + p);
  let checkedLinks = 0;
  for (const p of paths) {
    if (!/^[A-Za-z0-9._/\[\]-]+$/.test(p) || p.startsWith("/") || p.split("/").includes("..")) errors.push("Unsafe repository path: " + p);
    const content = files[p];
    if (!content.endsWith("\n")) errors.push("Missing final newline: " + p);
    if (!p.endsWith(".md")) continue;
    const re = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const m of content.matchAll(re)) {
      const href = m[1];
      if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
      const local = href.split("#")[0].split("?")[0];
      const parts = p.split("/").slice(0, -1);
      for (const segment of local.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") parts.pop(); else parts.push(segment);
      }
      const target = parts.join("/");
      checkedLinks++;
      if (!targetSet.has(target) && !targets.some(x => x.startsWith(target + "/"))) {
        errors.push("Broken relative link: " + p + " -> " + href);
      }
    }
  }
  const spec = files["docs/product/SPEC.md"] || "";
  const matrix = files["docs/development/ACCEPTANCE_MATRIX.md"] || "";
  const requiredIds = new Set(spec.match(/SA-[A-Z]+-\d{2}/g) || []);
  const coveredIds = new Set(matrix.match(/SA-[A-Z]+-\d{2}/g) || []);
  for (const id of requiredIds) if (!coveredIds.has(id)) errors.push("Requirement has no acceptance scenario: " + id);
  for (const id of coveredIds) if (!requiredIds.has(id)) errors.push("Unknown requirement in acceptance matrix: " + id);
  const decisions = files["docs/decisions/DECISIONS.md"] || "";
  for (let n = 1; n <= 36; n++) {
    const id = "D-" + String(n).padStart(2, "0");
    if (!decisions.includes("| " + id + " |")) errors.push("Missing accepted decision: " + id);
  }
  let metadata;
  try { metadata = JSON.parse(files["package.json"] || ""); }
  catch { errors.push("Invalid package.json"); }
  if (metadata?.sellerAgents?.stage === "documentation_only") {
    const unexpected = paths.filter(p => /^(?:apps|packages|tests|infra)\//.test(p) && !p.endsWith(".md"));
    if (unexpected.length) errors.push("Production files in documentation-only stage: " + unexpected.join(", "));
    for (const p of ["docs/STATUS.md", "docs/integrations/wildberries/README.md"]) {
      if (!(files[p] || "").includes("INSTALLED FAIL")) errors.push("WB installed-failure status missing: " + p);
    }
  }
  return { errors, files: paths.length, markdownFiles: paths.filter(p => p.endsWith(".md")).length,
    relativeLinks: checkedLinks, requirements: requiredIds.size,
    acceptanceScenarios: new Set(matrix.match(/\| A\d{2} \|/g) || []).size };
}

const ignored = new Set([".git", "node_modules", ".pnpm-store", ".venv", "__pycache__", "dist", "build", ".next", "coverage", "test-results", "playwright-report"]);
export function collectDocumentation(root) {
  const files = {};
  const repositoryPaths = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const path = relative(root, absolute).replaceAll("\\", "/");
        repositoryPaths.push(path);
        if (/\.(md|mjs|json|tsv|ya?ml)$/.test(path) || [".gitignore", ".editorconfig"].includes(path)) files[path] = readFileSync(absolute, "utf8");
      }
    }
  }
  visit(root);
  return { files, repositoryPaths };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const { files, repositoryPaths } = collectDocumentation(root);
  const result = checkDocumentation(files, repositoryPaths);
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log("Documentation check PASS: " + JSON.stringify(result));
    console.log("Scope: structure, relative file links and requirement coverage. No product tests executed.");
  }
}
