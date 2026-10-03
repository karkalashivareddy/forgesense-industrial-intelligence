#!/usr/bin/env node
/**
 * Documentation link checker.
 *
 * Verifies that every relative Markdown link in the repository resolves to a
 * file or directory that actually exists, and that links with an `#anchor`
 * target a heading that is actually present in the destination file.
 *
 * Scope and deliberate non-goals:
 *
 *  - Only repository-relative links are checked. `http(s)://`, `mailto:` and
 *    bare in-page anchors (`#foo`) are skipped: the first two are external, and
 *    the third resolves within the current file which cannot be broken by a
 *    rename elsewhere.
 *  - Directories count as valid targets so `[audit/](audit/)` links work.
 *  - A link into a directory is resolved as `<dir>/README.md` when one exists,
 *    matching how GitHub renders directory links, so an index link is checked
 *    against the index rather than passing merely because the folder exists.
 *
 * This exists because a broken link in documentation is invisible until a
 * reader follows it, and 30+ generated banners once pointed at an index that
 * had never been written.
 *
 * Exit codes: 0 clean, 1 broken links found, 2 bad invocation.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// The repository root is scanned recursively and already includes `docs/`,
// so listing subdirectories here would visit (and count) them twice.
const SCAN_DIRS = ['.'];
const MARKDOWN_EXT = new Set(['.md']);

/** Directories never worth walking into. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'target',
  'coverage',
  'test-results',
  'playwright-report',
  '.pytest_cache',
  '__pycache__',
  '.venv',
  'venv',
]);

/** Fenced code blocks must not be scanned; their contents are examples. */
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '').replace(/^~~~[\s\S]*?^~~~/gm, '');
}

/** Inline code spans can contain paths that are not links. */
function stripInlineCode(text) {
  return text.replace(/`[^`\n]*`/g, '');
}

/** GitHub slug rules, close enough for anchor verification. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function headingsOf(markdown) {
  const set = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) set.add(slugify(m[2]));
  }
  return set;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveTarget(fromDir, target) {
  const clean = target.split('#')[0];
  if (!clean) return { ok: true };
  const abs = resolve(fromDir, decodeURIComponent(clean));
  if (await exists(abs)) {
    const s = await stat(abs);
    if (s.isDirectory()) {
      // A directory link should render an index; verify that index exists.
      const index = join(abs, 'README.md');
      if (await exists(index)) return { ok: true, resolved: index, isIndex: true };
      return { ok: false, reason: 'directory has no README.md index' };
    }
    return { ok: true, resolved: abs };
  }
  return { ok: false, reason: 'target does not exist' };
}

async function collectMarkdown(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectMarkdown(full, acc);
    } else if (MARKDOWN_EXT.has(extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

async function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    if (await exists(abs)) await collectMarkdown(abs, files);
  }

  const problems = [];
  let checked = 0;

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const text = stripInlineCode(stripFences(raw));
    const relFile = relative(ROOT, file).replaceAll('\\', '/');
    const fromDir = dirname(file);

    let match;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(text)) !== null) {
      const target = match[1];
      if (!target) continue;
      if (/^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
      if (target.startsWith('#')) continue;

      checked += 1;
      const result = await resolveTarget(fromDir, target);
      if (!result.ok) {
        problems.push({ file: relFile, target, reason: result.reason });
        continue;
      }

      // Anchor verification, when one was supplied and we resolved to markdown.
      const hash = target.indexOf('#');
      if (hash >= 0 && result.resolved && MARKDOWN_EXT.has(extname(result.resolved))) {
        const anchor = decodeURIComponent(target.slice(hash + 1)).toLowerCase();
        if (anchor) {
          const headings = headingsOf(await readFile(result.resolved, 'utf8'));
          if (!headings.has(anchor)) {
            problems.push({
              file: relFile,
              target,
              reason: `anchor #${anchor} not found in ${relative(ROOT, result.resolved).replaceAll('\\', '/')}`,
            });
          }
        }
      }
    }
  }

  if (problems.length === 0) {
    console.log(`check:docs OK - ${checked} relative link(s) across ${files.length} markdown file(s)`);
    return 0;
  }

  console.error(`check:docs FAILED - ${problems.length} broken link(s):\n`);
  for (const p of problems) {
    console.error(`  ${p.file}  ->  ${p.target}`);
    console.error(`      ${p.reason}`);
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('check:docs failed to run:', error.message);
    process.exit(2);
  });
