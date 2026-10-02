#!/usr/bin/env node
/**
 * Debug-artifact gate for the console source tree.
 *
 * `package.json` documents `npm run lint:artifacts`, and the release
 * checklist requires "no debug artifacts: no console.log, no debugger, no
 * TODO/FIXME/HACK" — but this script did not exist, so the documented command
 * failed and the requirement was only enforced by a separate bash snippet in
 * CI. This is that check, owned by the frontend, so it can be run locally and
 * by CI from one place.
 *
 * It scans `src/` only. Generated output (`dist/`), dependencies
 * (`node_modules/`) and test fixtures are out of scope: a fixture may
 * legitimately contain the very strings this gate rejects.
 *
 * Exit codes: 0 clean, 1 findings, 2 bad invocation.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const RULES = [
  {
    id: 'console',
    // console.warn/error are also rejected: the console is a delivery
    // surface, so a stray log is a defect regardless of severity.
    pattern: /\bconsole\s*\.\s*(log|error|warn|debug|trace)\s*\(/g,
    message: 'console call left in shipped source',
  },
  {
    id: 'debugger',
    pattern: /\bdebugger\b/g,
    message: 'debugger statement left in shipped source',
  },
  {
    id: 'marker',
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/g,
    message: 'unresolved work marker left in shipped source',
  },
  {
    id: 'raw-dom',
    pattern: /\.innerHTML\s*=|document\s*\.\s*write\s*\(/g,
    message: 'raw DOM write bypasses the React render path',
  },
];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/** Ignore rule, mirroring how an editor or bundler would treat the line. */
function isCommentLine(trimmed) {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--')
  );
}

async function collect(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collect(full)));
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

async function main() {
  const files = await collect(SRC);
  const findings = [];

  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      // Comments legitimately describe these patterns; skip them.
      if (isCommentLine(line.trim())) return;
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(line)) {
          findings.push({
            file: relative(ROOT, file).replaceAll('\\', '/'),
            line: index + 1,
            id: rule.id,
            message: rule.message,
            text: line.trim().slice(0, 100),
          });
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log(`check-artifacts: clean (${files.length} files scanned under src/)`);
    return 0;
  }

  console.error(`check-artifacts: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.id}] ${f.message}`);
    console.error(`    ${f.text}`);
  }
  console.error('\nRemove these before release. See docs/RELEASE_CHECKLIST.md.');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('check-artifacts failed to run:', error.message);
    process.exit(2);
  });
