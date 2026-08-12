// The update check runs unattended against a network the app does not control,
// so the cases that matter are the ones nobody sees: a rate-limited API, a tag
// that does not parse, a version the user already said no to. Each of those has
// to end as silence, not as a dialog and not as a throw.

import { describe, it, expect, vi } from 'vitest';
import { parseVersion, isNewer, findUpdate } from './update.js';

const ok = (body) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

describe('parseVersion', () => {
  it('reads a plain and a v-prefixed version', () => {
    expect(parseVersion('3.4.0')).toEqual([3, 4, 0]);
    expect(parseVersion('v3.4.0')).toEqual([3, 4, 0]);
  });

  it('rejects anything that is not exactly three numbers', () => {
    for (const bad of ['3.4', '3.4.0-rc.1', 'latest', '', null, undefined, {}]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('isNewer', () => {
  it('compares part by part rather than lexically', () => {
    expect(isNewer('3.10.0', '3.9.0')).toBe(true); // would be false as a string
    expect(isNewer('4.0.0', '3.99.99')).toBe(true);
    expect(isNewer('3.4.1', '3.4.0')).toBe(true);
  });

  it('is false for the same version and for older ones', () => {
    expect(isNewer('3.4.0', '3.4.0')).toBe(false);
    expect(isNewer('3.3.9', '3.4.0')).toBe(false);
  });

  it('is false when either side is unparseable', () => {
    expect(isNewer('nightly', '3.4.0')).toBe(false);
    expect(isNewer('3.4.0', 'nightly')).toBe(false);
  });
});

describe('findUpdate', () => {
  it('reports a newer release', async () => {
    const fetchImpl = ok({ tag_name: 'v3.5.0' });
    await expect(findUpdate({ currentVersion: '3.4.0', fetchImpl })).resolves.toBe('3.5.0');
  });

  it('says nothing when the release matches what is running', async () => {
    const fetchImpl = ok({ tag_name: 'v3.4.0' });
    await expect(findUpdate({ currentVersion: '3.4.0', fetchImpl })).resolves.toBeNull();
  });

  it('says nothing about a version the user skipped', async () => {
    const fetchImpl = ok({ tag_name: 'v3.5.0' });
    await expect(
      findUpdate({ currentVersion: '3.4.0', skippedVersion: '3.5.0', fetchImpl }),
    ).resolves.toBeNull();
  });

  it('still reports a version newer than the skipped one', async () => {
    const fetchImpl = ok({ tag_name: 'v3.6.0' });
    await expect(
      findUpdate({ currentVersion: '3.4.0', skippedVersion: '3.5.0', fetchImpl }),
    ).resolves.toBe('3.6.0');
  });

  it('stays silent on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(findUpdate({ currentVersion: '3.4.0', fetchImpl })).resolves.toBeNull();
  });

  it('stays silent on a rate-limited or errored response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(findUpdate({ currentVersion: '3.4.0', fetchImpl })).resolves.toBeNull();
  });

  it('stays silent when the body is not what GitHub promises', async () => {
    for (const body of [{}, { tag_name: null }, { tag_name: 'nightly' }]) {
      await expect(findUpdate({ currentVersion: '3.4.0', fetchImpl: ok(body) })).resolves.toBeNull();
    }
  });
});
