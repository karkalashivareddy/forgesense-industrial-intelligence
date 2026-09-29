/**
 * Colour token integrity.
 *
 * An undefined CSS custom property does not error. `var(--does-not-exist)`
 * silently resolves to nothing, so a stale token name renders as an inherited
 * colour, a transparent background, or a missing border â€” and nothing in the
 * type checker, the test suite, or the browser console notices.
 *
 * That is not hypothetical. The semantic colour migration renamed every token
 * in `tokens.css`, and 33 inline `var(--old-name)` references across 12
 * component files were missed. The Scenario Lab "What to watch" strip rendered
 * with fully transparent backgrounds on all 7 segments, and the Twin dependency
 * legend swatches had no colour. The hex-literal colour audit could not catch
 * it, because the values were token *references*, not literals.
 *
 * This test closes that gap: every `var(--*)` referenced anywhere in `src/`
 * must be defined in `tokens.css`. Adding a token reference without defining
 * the token now fails here rather than in a screenshot.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const TOKENS_FILE = join(SRC, 'styles', 'tokens.css');

/** The six data-basis labels, lowercased, as they appear in token names. */
const BASES = ['observed', 'derived', 'predicted', 'synthetic', 'simulated', 'unavailable'];

/** Every defined custom property name, e.g. `--color-accent`. */
function definedTokens(): Set<string> {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    names.add(match[1]!);
  }
  return names;
}

/** Every source file we intend to hold token references. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments, which legitimately *describe* token patterns.
 *
 * Both `tokens.css` and `design-system/index.tsx` document the
 * `var(--color-{basis}-text)` convention in prose. Those are not references,
 * and a test that cannot tell the difference trains people to ignore it.
 */
function stripComments(text: string, isCss: boolean): string {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (isCss) return withoutBlock;
  // Leaves string literals intact so template literals are still detected.
  return withoutBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

describe('colour token integrity', () => {
  const defined = definedTokens();

  it('tokens.css defines a non-trivial palette', () => {
    // A guard on the guard: if this parsing ever returns nothing, every
    // assertion below would pass vacuously.
    expect(defined.size).toBeGreaterThan(60);
  });

  it('every var(--token) referenced in src is actually defined', () => {
    const missing: string[] = [];

    for (const file of sourceFiles()) {
      const text = stripComments(readFileSync(file, 'utf8'), file.endsWith('.css'));

      // Plain references: `var(--color-accent)`. A name immediately followed by
      // `$` is a template-literal prefix (`var(--color-${basis}-text)`), which
      // the provenance check below expands.
      for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)(\$|\s*\))/gi)) {
        if (match[2] === '$') continue;
        const name = match[1]!;
        if (!defined.has(name)) missing.push(`${relative(SRC, file)}: ${name}`);
      }

      /*
       * Template-literal references. `<BasisChip>` builds its colour with
       * `var(--color-${basis}-text)`, so the literal prefix `--color-` is not a
       * real token. Expand it over the six provenance bases instead of
       * reporting a false positive, which also asserts that every member of
       * the family exists â€” the exact gap that left OBSERVED, PREDICTED and
       * SIMULATED chips rendering with an invisible dot.
       */
      if (/var\(\s*--color-\$\{/.test(text)) {
        for (const basis of BASES) {
          for (const suffix of ['', '-bg', '-border', '-text']) {
            const name = `--color-${basis}${suffix}`;
            if (!defined.has(name)) {
              missing.push(`${relative(SRC, file)}: ${name} (provenance family)`);
            }
          }
        }
      }
    }

    // Deduplicate: one broken name in one file is one finding, not one per use.
    expect([...new Set(missing)]).toEqual([]);
  });

  it('no legacy short token names survive the semantic migration', () => {
    /*
     * The pre-migration vocabulary. These are banned outright rather than
     * merely checked for definition, because a future redefinition of, say,
     * `--crit` would restore exactly the ambiguity the semantic system exists
     * to remove: one colour per concept, named for the concept.
     */
    const legacy = [
      '--ok',
      '--warn',
      '--crit',
      '--info',
      '--maint',
      '--idle',
      '--brand',
      '--ml',
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--text-faint',
      '--bg-base',
      '--bg-void',
      '--bg-surface',
      '--bg-raised',
      '--bg-inset',
      '--bg-overlay',
      '--edge-subtle',
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = stripComments(readFileSync(file, 'utf8'), file.endsWith('.css'));
      for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (match[0].includes('$')) continue;
        if (legacy.includes(match[1]!)) {
          offenders.push(`${relative(SRC, file)}: ${match[1]!}`);
        }
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
