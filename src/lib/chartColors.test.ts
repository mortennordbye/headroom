/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHART } from './chartColors';

// CHART holds literal copies of the theme tokens because SVG attributes can't
// resolve var(--…). This fails when a token in index.css is retuned and the
// mirror isn't.
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

// Top-level :root only — the print override further down is indented.
function rootTokens(source: string): Record<string, string> {
  const block = source.match(/^:root\s*\{([\s\S]*?)^\}/m);
  if (!block) throw new Error('no top-level :root block in index.css');
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const tokens = rootTokens(css);

function resolve(name: string): string | undefined {
  const value = tokens[name];
  const alias = value?.match(/^var\((--[\w-]+)\)$/);
  return alias ? tokens[alias[1]] : value;
}

const MIRRORS: [keyof typeof CHART, string][] = [
  ['forest', '--forest'],
  ['forestLight', '--forest-light'],
  ['teal', '--teal'],
  ['slate', '--slate'],
  ['rust', '--rust'],
  ['brass', '--brass'],
  ['text1', '--text'],
  ['textDim', '--text-dim'],
  ['textSoft', '--text-soft'],
  ['bgCard', '--bg-2'],
  ['bg3', '--bg-3'],
  ['rule', '--rule'],
  ['surface2', '--surface-2'],
];

describe('CHART mirrors the CSS tokens', () => {
  it('resolves one level of var() aliasing', () => {
    expect(resolve('--text-1')).toBe(tokens['--text']);
  });

  it.each(MIRRORS)('CHART.%s matches %s', (key, token) => {
    const value = resolve(token);
    expect(value, `${token} not found in :root`).toBeDefined();
    expect(CHART[key].toLowerCase()).toBe(value!.toLowerCase());
  });
});
