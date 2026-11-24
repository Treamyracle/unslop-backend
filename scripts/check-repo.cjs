#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency repository integrity checker:
 * 1. Confirms all required root files, manifests, schemas, gate scripts, fixtures, and assets exist.
 * 2. Parses every JSON manifest, schema, and sample output file.
 * 3. Verifies every relative Markdown link in README.md, docs/STATUS.md, SKILL.md, and i18n/*.md resolves.
 * 4. Audits SVG files for valid viewBox, defined url(#...) references, and text-fit bounds.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const errors = [];

const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".gitignore",
  ".gitattributes",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "gemini-extension.json",
  "assets/logo.svg",
  "assets/icon.png",
  "docs/STATUS.md",
  "docs/assets/hero-banner.svg",
  "docs/assets/architecture-flow.svg",
  "docs/assets/benchmark-proof.svg",
  "skills/unslop-backend/SKILL.md",
  "skills/unslop-backend/RECONNAISSANCE.md",
  "skills/unslop-backend/BASELINE-AND-GOLDEN.md",
  "skills/unslop-backend/HUNTING.md",
  "skills/unslop-backend/VALIDATION-AND-REPORTING.md",
  "skills/unslop-backend/SLOP-CLASSES.md",
  "skills/unslop-backend/ORM-AND-N-PLUS-ONE.md",
  "skills/unslop-backend/SQL-INDEXES-AND-QUERY-PLANS.md",
  "skills/unslop-backend/PAYLOADS-STREAMING-AND-SERIALIZATION.md",
  "skills/unslop-backend/ASYNC-WATERFALLS-AND-CACHING.md",
  "skills/unslop-backend/MEMORY-STREAMS-AND-COLD-STARTS.md",
  "skills/unslop-backend/AI-PIPELINE-AND-LLM-IO-SLOP.md",
  "skills/unslop-backend/workload-ledger-schema.json",
  "skills/unslop-backend/benchmark-schema.json",
  "skills/unslop-backend/report-schema.json",
  "skills/unslop-backend/scan-slop.cjs",
  "skills/unslop-backend/validate-workload-ledger.cjs",
  "skills/unslop-backend/compare-benchmarks.cjs",
  "skills/unslop-backend/validate-findings.cjs",
  "examples/sloppy-saas-api/db.js",
  "examples/sloppy-saas-api/sloppy-server.js",
  "examples/sloppy-saas-api/unslopped-server.js",
  "examples/sloppy-saas-api/benchmarks/run-benchmark.cjs",
  "examples/sloppy-saas-api/benchmarks/slop-proof.bench.test.cjs",
  "examples/case-studies/uptime-kuma/README.md",
  "examples/case-studies/uptime-kuma/reproduce.cjs",
  "examples/case-studies/uptime-kuma/reproduce.test.cjs",
  "examples/case-studies/uptime-kuma/baseline.json",
  "examples/case-studies/uptime-kuma/after.json",
  "examples/sample-audit-output/architecture.md",
  "examples/sample-audit-output/workload-ledger.json",
  "examples/sample-audit-output/baseline.json",
  "examples/sample-audit-output/after.json",
  "examples/sample-audit-output/findings.json",
  "examples/sample-audit-output/REPORT.md",
  "examples/sample-audit-output/BENCHMARKS.md",
  "examples/sample-audit-output/FINDINGS-DETAIL.md",
  "examples/sample-audit-output/NEEDS-VALIDATION.md",
];

for (const rel of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    errors.push(`Missing required file: ${rel}`);
  }
}

const JSON_FILES = [
  "package.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  "plugin.json",
  "gemini-extension.json",
  "skills/unslop-backend/workload-ledger-schema.json",
  "skills/unslop-backend/benchmark-schema.json",
  "skills/unslop-backend/report-schema.json",
  "examples/sample-audit-output/workload-ledger.json",
  "examples/sample-audit-output/baseline.json",
  "examples/sample-audit-output/after.json",
  "examples/sample-audit-output/findings.json",
  "examples/case-studies/uptime-kuma/baseline.json",
  "examples/case-studies/uptime-kuma/after.json",
];

for (const rel of JSON_FILES) {
  const full = path.join(ROOT, rel);
  try {
    JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (err) {
    errors.push(`Invalid JSON in ${rel}: ${err.message}`);
  }
}

function checkMarkdownLinks(mdRel) {
  const full = path.join(ROOT, mdRel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing markdown file: ${mdRel}`);
    return;
  }
  const text = fs.readFileSync(full, "utf-8");
  const dir = path.dirname(full);
  const linkRegex = /(?:!\[[^\]]*\]|\[[^\]]*\])\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const rawTarget = match[1].trim().split(/\s+/)[0];
    if (
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("mailto:")
    ) {
      continue;
    }
    const cleanTarget = rawTarget.split("#")[0];
    if (!cleanTarget) continue;
    const resolved = path.resolve(dir, cleanTarget);
    if (!fs.existsSync(resolved)) {
      errors.push(
        `Broken relative link in ${mdRel}: (${rawTarget}) -> missing ${path.relative(ROOT, resolved)}`
      );
    }
  }
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function checkSvgFile(svgRel) {
  const full = path.join(ROOT, svgRel);
  if (!fs.existsSync(full)) return;
  const txt = fs.readFileSync(full, "utf-8");

  const vbMatch = txt.match(/<svg[^>]*viewBox="0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
  if (!vbMatch) {
    errors.push(`SVG ${svgRel} is missing explicit viewBox="0 0 W H"`);
    return;
  }
  const svgWidth = Number(vbMatch[1]);
  if (!txt.includes("</svg>")) {
    errors.push(`SVG ${svgRel} is missing closing </svg> tag`);
  }

  const definedIds = new Set([...txt.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const refMatch of txt.matchAll(/url\(#([^)]+)\)/g)) {
    if (!definedIds.has(refMatch[1])) {
      errors.push(`SVG ${svgRel} references undefined url(#${refMatch[1]})`);
    }
  }

  const rects = [];
  for (const m of txt.matchAll(/<rect\b([^>]*)>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx="([^"]+)"/) || [, 0])[1]);
    const y = Number((attrs.match(/\by="([^"]+)"/) || [, 0])[1]);
    const wMatch = attrs.match(/\bwidth="([^"]+)"/);
    const hMatch = attrs.match(/\bheight="([^"]+)"/);
    if (!wMatch || !hMatch) continue;
    const w = Number(wMatch[1]);
    const h = Number(hMatch[1]);
    if (x === 0 && y === 0 && w >= svgWidth) continue;
    rects.push({ x, y, w, h });
  }

  for (const m of txt.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1];
    const x = Number((attrs.match(/\bx="([^"]+)"/) || [, 0])[1]);
    const y = Number((attrs.match(/\by="([^"]+)"/) || [, 0])[1]);
    const fsMatch = attrs.match(/font-size="([^"]+)"/);
    if (!fsMatch) {
      errors.push(`SVG ${svgRel} <text> at (${x},${y}) is missing explicit font-size`);
    }
    const fontSize = fsMatch ? Number(fsMatch[1]) : 12;
    const isMiddle = /text-anchor="middle"/.test(attrs);
    const content = decodeXmlEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    const estWidth = content.length * fontSize * 0.63;

    const container = rects.find(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h + 4
    );

    if (isMiddle) {
      if (container && estWidth > container.w - 8) {
        errors.push(
          `SVG ${svgRel} centered text "${content}" (est ${estWidth.toFixed(1)}px) overflows rect width ${container.w}px`
        );
      }
    } else {
      if (container && x + estWidth > container.x + container.w - 8) {
        errors.push(
          `SVG ${svgRel} text "${content}" overflows container rect right edge`
        );
      }
      if (x + estWidth > svgWidth - 8) {
        errors.push(
          `SVG ${svgRel} text "${content}" extends past viewBox width (${svgWidth}px)`
        );
      }
    }
  }
}

checkMarkdownLinks("README.md");
checkMarkdownLinks("docs/STATUS.md");
checkMarkdownLinks("examples/case-studies/uptime-kuma/README.md");
for (const f of fs.readdirSync(path.join(ROOT, "skills/unslop-backend")).filter((n) => n.endsWith(".md"))) {
  checkMarkdownLinks(`skills/unslop-backend/${f}`);
}

const i18nDir = path.join(ROOT, "i18n");
if (!fs.existsSync(i18nDir)) {
  errors.push("Missing i18n directory");
} else {
  const i18nFiles = fs.readdirSync(i18nDir).filter((f) => f.endsWith(".md"));
  if (i18nFiles.length < 10) {
    errors.push(`Expected at least 10 localized READMEs in i18n/, found ${i18nFiles.length}`);
  }
  for (const f of i18nFiles) {
    checkMarkdownLinks(`i18n/${f}`);
  }
}

checkSvgFile("assets/logo.svg");
checkSvgFile("docs/assets/hero-banner.svg");
checkSvgFile("docs/assets/architecture-flow.svg");
checkSvgFile("docs/assets/benchmark-proof.svg");

if (errors.length > 0) {
  console.error(`Repository check FAILED (${errors.length} error(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `Repository check PASSED: ${REQUIRED_FILES.length} required files, ${JSON_FILES.length} JSON files, 4 SVGs, and all relative Markdown links verified.`
);
