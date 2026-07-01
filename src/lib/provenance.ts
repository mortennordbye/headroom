export type Provenance = 'default' | 'custom' | 'estimate';

/** Compare a value to its default. Equal → still a default; different → the user set it. */
export function provenanceOf(value: number, defaultValue: number): Provenance {
  return value === defaultValue ? 'default' : 'custom';
}
