import { describe, it, expect } from 'vitest';
import { GLOSSARY_TERMS, glossaryTermsFor } from './glossary';

describe('glossaryTermsFor', () => {
  it('hides Norway-specific terms outside the Norwegian region', () => {
    const generic = glossaryTermsFor('generic');
    expect(generic.every((term) => !term.no)).toBe(true);
    expect(generic.some((term) => term.key === 'trinnskatt')).toBe(false);
    expect(generic.some((term) => term.key === 'headroom')).toBe(true);
  });

  it('shows every term in the Norwegian region', () => {
    expect(glossaryTermsFor('no')).toHaveLength(GLOSSARY_TERMS.length);
  });

  it('has unique keys', () => {
    const keys = GLOSSARY_TERMS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
