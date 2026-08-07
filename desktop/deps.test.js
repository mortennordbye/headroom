// The desktop app can't share server/node_modules: its child process is
// Electron's Node, so better-sqlite3 has to be the Electron-ABI build. That
// means desktop/package.json repeats the server's runtime dependencies, and a
// drift between the two doesn't fail the build — it fails at runtime, inside a
// packaged app, on someone else's machine. Catch it here instead.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => JSON.parse(readFileSync(join(import.meta.dirname, rel), 'utf8'));

describe('desktop app dependencies', () => {
  it('are exactly the server dependencies it runs', () => {
    expect(read('./package.json').dependencies).toEqual(read('../server/package.json').dependencies);
  });
});
