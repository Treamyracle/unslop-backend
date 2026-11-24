#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency polyglot static pre-scanner for backend slop candidate leads.
 * Emits candidate leads ONLY — never confirmed verdicts until benchmarked.
 *
 * Usage:
 *   node scan-slop.cjs [--json] [--format text|markdown] [--max-files <N>] [--help] <target-file-or-dir>
 */

const fs = require("node:fs");
const path = require("node:path");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  "target",
  "coverage",
]);

const SUPPORTED_EXTS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rb",
  ".sql",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function isCommentLine(line, ext) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (ext === ".py" || ext === ".rb") return trimmed.startsWith("#");
  if (ext === ".sql") return trimmed.startsWith("--") || trimmed.startsWith("/*");
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

function collectFiles(targetPath, maxFiles = 2000) {
  const files = [];
  const root = path.resolve(targetPath);
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return [{ full: root, rel: path.basename(root) }];
  }

  function walk(dir) {
    if (files.length >= maxFiles) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (files.length >= maxFiles) return;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name));
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;
        const full = path.join(dir, ent.name);
        try {
          if (fs.statSync(full).size <= MAX_FILE_BYTES) {
            files.push({
              full,
              rel: path.relative(root, full).replace(/\\/g, "/"),
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(root);
  return files;
}

function stripStringAndTrailingComment(line) {
  // Lightweight helper only for brace counting so strings don't skew loop depth
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, "");
}

function scanSourceText(text, relPath, ext) {
  const leads = [];
  const lines = text.split(/\r\n|\r|\n/);

  const pushLead = (ruleId, slopClass, severityHint, lineNum, snippet, message) => {
    leads.push({
      rule_id: ruleId,
      slop_class: slopClass,
      severity_hint: severityHint,
      file: relPath,
      line: lineNum,
      snippet: snippet.trim().slice(0, 140),
      message,
      candidate_only: true,
    });
  };

  // State for brace-delimited loops (JS/TS/Go) and indent-delimited loops (Python)
  const loopBraceStack = [];
  const pyLoopIndentStack = [];
  let braceDepth = 0;

  // State for sequential await waterfall detection
  let awaitRun = [];
  const flushAwaitRun = () => {
    if (awaitRun.length >= 3) {
      const first = awaitRun[0];
      pushLead(
        "SEQUENTIAL_AWAIT_WATERFALL",
        "async_waterfall",
        "medium",
        first.line,
        first.text,
        `${awaitRun.length} sequential independent await calls; verify if Promise.all / asyncio.gather applies`
      );
    }
    awaitRun = [];
  };

  const isPy = ext === ".py";
  const isBraceLang = [".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".go"].includes(ext);

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    const trimmed = rawLine.trim();

    if (isCommentLine(rawLine, ext)) {
      continue;
    }

    // Check Python indent loop exit
    if (isPy) {
      const indent = rawLine.match(/^(\s*)/)[1].length;
      while (
        pyLoopIndentStack.length > 0 &&
        indent <= pyLoopIndentStack[pyLoopIndentStack.length - 1]
      ) {
        pyLoopIndentStack.pop();
      }
    }

    // 1. SELECT *
    if (/\bSELECT\s+\*\s+FROM\b/i.test(rawLine) || /columns\s*:\s*["']\*["']/.test(rawLine)) {
      pushLead(
        "SELECT_STAR",
        "overfetch_and_payload_bloat",
        "medium",
        lineNum,
        rawLine,
        "Wildcard column selection (`SELECT *` / `columns: \"*\"`) risks reading/sending unused blobs"
      );
    }

    // 2. OFFSET pagination
    if (
      /\bOFFSET\s+(?:\$|\?|\d|[:@])/i.test(rawLine) ||
      /\.offset\s*\(/.test(rawLine) ||
      /\bskip\s*:\s*(?:offset|skip|page\s*\*)/i.test(rawLine)
    ) {
      pushLead(
        "OFFSET_PAGINATION",
        "missing_or_broken_index",
        "medium",
        lineNum,
        rawLine,
        "OFFSET/skip pagination scans discarded rows at deep pages; consider keyset cursor pagination"
      );
    }

    // 3. Unpaginated findMany / objects.all()
    if (
      /\.findMany\s*\(\s*(?:\{\s*\}|\{\s*where\s*:[^}]*\}\s*)?\)/.test(rawLine) &&
      !/\btake\s*:/.test(rawLine)
    ) {
      pushLead(
        "UNPAGINATED_FIND_ALL",
        "overfetch_and_payload_bloat",
        "high",
        lineNum,
        rawLine,
        "Unbounded `.findMany()` without `take`/limit can return unbounded rows"
      );
    } else if (/\.objects\.all\s*\(\s*\)/.test(rawLine)) {
      pushLead(
        "UNPAGINATED_FIND_ALL",
        "overfetch_and_payload_bloat",
        "high",
        lineNum,
        rawLine,
        "Unbounded `.objects.all()` loads full table/queryset unless sliced downstream"
      );
    }

    // 4. Synchronous filesystem I/O inside server/handler code
    if (/\b(?:readFileSync|writeFileSync)\s*\(/.test(rawLine) && isBraceLang) {
      pushLead(
        "SYNC_IO_IN_HANDLER",
        "memory_and_stream_slop",
        "medium",
        lineNum,
        rawLine,
        "Synchronous fs call blocks the Node.js event loop if executed on a request path"
      );
    }

    // 5. Unbounded module-level Map/Set caches (heuristic)
    if (
      /^(?:const|let|var)\s+\w*(?:cache|store|memo|seen|sessions)\w*\s*=\s*new\s+(?:Map|Set)\s*\(/i.test(
        trimmed
      ) &&
      !/lru|max|ttl/i.test(rawLine)
    ) {
      pushLead(
        "UNBOUNDED_IN_MEMORY_CACHE",
        "memory_and_stream_slop",
        "medium",
        lineNum,
        rawLine,
        "Module-level Map/Set cache without apparent maxSize/LRU eviction can leak memory"
      );
    }

    // Track loop depth BEFORE evaluating inside-loop checks
    let enteredLoopHere = false;
    if (isBraceLang) {
      if (/^(?:for\s*\(|for\s+await\s*\(|while\s*\(|for\s+[A-Za-z0-9_,\s]+:=\s*range\b)/.test(trimmed)) {
        const clean = stripStringAndTrailingComment(rawLine);
        const opens = (clean.match(/\{/g) || []).length;
        const closes = (clean.match(/\}/g) || []).length;
        const nextDepth = braceDepth + opens - closes;
        if (opens > closes) {
          loopBraceStack.push(braceDepth);
        }
        braceDepth = Math.max(0, nextDepth);
        enteredLoopHere = true;
      }
    } else if (isPy) {
      if (/^(?:async\s+)?(?:for\b|while\b).*:\s*$/.test(trimmed)) {
        const indent = rawLine.match(/^(\s*)/)[1].length;
        pyLoopIndentStack.push(indent);
        enteredLoopHere = true;
      }
    }

    const insideLoop =
      (isBraceLang && loopBraceStack.length > 0 && !enteredLoopHere) ||
      (isPy && pyLoopIndentStack.length > 0 && !enteredLoopHere);

    // 6. AWAIT / DB / HTTP call inside loop
    if (insideLoop) {
      const hasLoopIo =
        /\bawait\b/.test(rawLine) &&
        /(?:db\.|prisma\.|knex|sequelize|repo\.|find|query|execute|select|fetch\(|axios\.|embed|client\.)/i.test(
          rawLine
        );
      const hasSyncDbInLoop =
        /(?:session\.get\(|cursor\.execute\(|\.objects\.(?:get|filter)\(|\.First\(|\.Find\()/.test(
          rawLine
        );
      if (hasLoopIo || hasSyncDbInLoop) {
        pushLead(
          "AWAIT_IN_LOOP",
          "n_plus_one_cascade",
          "high",
          lineNum,
          rawLine,
          "Database/ORM/HTTP call executed inside loop body (candidate N+1 cascade or loop waterfall)"
        );
      }

      if (/JSON\.parse\s*\(\s*JSON\.stringify\s*\(/.test(rawLine)) {
        pushLead(
          "DEEP_CLONE_IN_LOOP",
          "memory_and_stream_slop",
          "medium",
          lineNum,
          rawLine,
          "`JSON.parse(JSON.stringify(...))` deep clone inside loop causes quadratic serialization churn"
        );
      }
    }

    // 7. Sequential independent await chain (outside loops so we don't double-report)
    if (!insideLoop && isBraceLang) {
      const awaitMatch = trimmed.match(/^(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\b/);
      if (awaitMatch) {
        const varName = awaitMatch[1];
        const rhs = trimmed.slice(trimmed.indexOf("await"));
        const dependsOnPrev = awaitRun.some((prev) =>
          new RegExp(`\\b${prev.varName}\\b`).test(rhs)
        );
        if (dependsOnPrev) {
          flushAwaitRun();
        }
        awaitRun.push({ varName, line: lineNum, text: rawLine });
      } else {
        flushAwaitRun();
      }
    } else if (!isBraceLang) {
      flushAwaitRun();
    }

    // Update brace depth for non-loop lines
    if (isBraceLang && !enteredLoopHere) {
      const clean = stripStringAndTrailingComment(rawLine);
      const opens = (clean.match(/\{/g) || []).length;
      const closes = (clean.match(/\}/g) || []).length;
      braceDepth = Math.max(0, braceDepth + opens - closes);
      while (
        loopBraceStack.length > 0 &&
        braceDepth <= loopBraceStack[loopBraceStack.length - 1]
      ) {
        loopBraceStack.pop();
      }
    }
  }

  flushAwaitRun();
  return leads;
}

function scanTarget(targetPath, options = {}) {
  const maxFiles = options.maxFiles || 2000;
  const files = collectFiles(targetPath, maxFiles);
  const leads = [];
  for (const f of files) {
    const text = fs.readFileSync(f.full, "utf-8");
    const ext = path.extname(f.full).toLowerCase();
    const fileLeads = scanSourceText(text, f.rel, ext);
    leads.push(...fileLeads);
  }
  return {
    candidate_only: true,
    note: "Candidate leads only — confirm with runtime baseline measurement before reporting.",
    scanned_files: files.length,
    lead_count: leads.length,
    leads,
  };
}

function formatLeadsMarkdown(result) {
  const lines = [
    `# Static Pre-Scan Leads (${result.lead_count} candidate(s) across ${result.scanned_files} file(s))`,
    "",
    `> **${result.note}**`,
    "",
  ];
  if (result.leads.length === 0) {
    lines.push("No heuristic slop leads matched.");
    return lines.join("\n");
  }
  lines.push("| File:Line | Rule | Slop Class | Lead Description |");
  lines.push("|---|---|---|---|");
  for (const l of result.leads) {
    lines.push(`| \`${l.file}:${l.line}\` | \`${l.rule_id}\` | \`${l.slop_class}\` | ${l.message} |`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { json: false, format: "text", maxFiles: 2000, help: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--format") {
      if (i + 1 >= argv.length) throw new Error("--format requires text or markdown");
      opts.format = argv[++i];
    } else if (arg === "--max-files") {
      if (i + 1 >= argv.length) throw new Error("--max-files requires an integer");
      opts.maxFiles = Number.parseInt(argv[++i], 10);
      if (!Number.isInteger(opts.maxFiles) || opts.maxFiles < 1) {
        throw new Error("--max-files must be >= 1");
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!opts.target) {
      opts.target = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node scan-slop.cjs [options] <file-or-directory>",
      "",
      "Options:",
      "  --json                 Emit JSON output (candidate_only: true)",
      "  --format <fmt>         Human format: text (default) or markdown",
      "  --max-files <N>        Cap scanned files (default 2000)",
      "  --help, -h             Show this help message",
    ].join("\n")
  );
}

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.target) {
    printHelp();
    process.exit(1);
  }
  let res;
  try {
    res = scanTarget(opts.target, { maxFiles: opts.maxFiles });
  } catch (err) {
    console.error(`Scan failed: ${err.message}`);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
  } else if (opts.format === "markdown") {
    console.log(formatLeadsMarkdown(res));
  } else {
    console.log(`Scanned ${res.scanned_files} file(s) -> ${res.lead_count} candidate lead(s).`);
    console.log(`NOTE: ${res.note}`);
    for (const l of res.leads) {
      console.log(`  [${l.slop_class}] ${l.file}:${l.line} (${l.rule_id}) - ${l.message}`);
    }
  }
  process.exit(0);
}

module.exports = {
  SKIP_DIRS,
  SUPPORTED_EXTS,
  scanSourceText,
  scanTarget,
  formatLeadsMarkdown,
};
