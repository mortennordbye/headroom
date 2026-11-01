import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_TOPICS,
  ONBOARDING_TOPIC_COUNT,
  ONBOARDING_GROUPS,
  topicsInGroup,
  topicById,
  topicIndex,
  nextTopic,
  planOwnershipShare,
} from './onboarding';
import type { CoOwner } from '../context/FinanceContext';

describe('onboarding topic catalog', () => {
  it('has unique topic ids', () => {
    const ids = ONBOARDING_TOPICS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every topic has a route and a known group', () => {
    for (const t of ONBOARDING_TOPICS) {
      expect(t.route.startsWith('/')).toBe(true);
      expect(ONBOARDING_GROUPS).toContain(t.group);
    }
  });

  it('fill topics have at least one field; learn topics have none', () => {
    for (const t of ONBOARDING_TOPICS) {
      if (t.kind === 'fill') expect(t.fields.length).toBeGreaterThan(0);
      else expect(t.fields.length).toBe(0);
    }
  });

  it('select fields carry options; numeric fields do not', () => {
    for (const t of ONBOARDING_TOPICS) {
      for (const f of t.fields) {
        if (f.kind === 'select') expect(Array.isArray(f.options) && f.options.length > 0).toBe(true);
        else expect(f.options).toBeUndefined();
      }
    }
  });

  it('every field has a valid writer and non-empty key', () => {
    const writers = new Set(['lang', 'region', 'income', 'savingsTarget', 'asset', 'pension', 'growthRate', 'ownershipShare']);
    for (const t of ONBOARDING_TOPICS) {
      for (const f of t.fields) {
        expect(writers.has(f.writer)).toBe(true);
        expect(f.key.length).toBeGreaterThan(0);
      }
    }
  });

  it('groups partition the catalog with no orphans', () => {
    const counted = ONBOARDING_GROUPS.reduce((sum, g) => sum + topicsInGroup(g).length, 0);
    expect(counted).toBe(ONBOARDING_TOPIC_COUNT);
    for (const g of ONBOARDING_GROUPS) expect(topicsInGroup(g).length).toBeGreaterThan(0);
  });
});

describe('onboarding catalog lookups', () => {
  it('topicById finds and misses correctly', () => {
    expect(topicById('income')?.id).toBe('income');
    expect(topicById('nope')).toBeUndefined();
  });

  it('topicIndex is consistent with the array', () => {
    expect(topicIndex(ONBOARDING_TOPICS[0].id)).toBe(0);
    expect(topicIndex('nope')).toBe(-1);
  });

  it('nextTopic advances and returns null past the end', () => {
    expect(nextTopic(ONBOARDING_TOPICS[0].id)?.id).toBe(ONBOARDING_TOPICS[1].id);
    expect(nextTopic(ONBOARDING_TOPICS[ONBOARDING_TOPIC_COUNT - 1].id)).toBeNull();
    expect(nextTopic('nope')).toBeNull();
  });
});

describe('planOwnershipShare (committing the onboarding answer)', () => {
  const M = '2026-11';
  const row = { id: 'coo-new', name: 'Medeier 1' };
  const old: CoOwner = { id: 'coo-1', name: 'Medeier 1', ownershipPct: 50, since: '2023-04' };

  it('does nothing for a partial or out-of-range draft', () => {
    for (const raw of ['', '1x', '-5', '150']) {
      expect(planOwnershipShare(raw, [old], M, row)).toEqual({ kind: 'none' });
    }
  });

  it('typing "100" over an earlier co-owner ends their row; history keeps the split', () => {
    // The old write-per-keystroke bug: "1" and "10" were written on the way, leaving 90 % in place.
    expect(planOwnershipShare('100', [old], M, row)).toEqual({ kind: 'write', coOwners: [{ ...old, until: '2026-10' }] });
  });

  it('always plans from the list the step opened with, so answers never stack', () => {
    const open = [old];
    expect(planOwnershipShare('90', open, M, row))
      .toEqual({ kind: 'write', coOwners: [{ ...old, until: '2026-10' }, { ...old, id: row.id, ownershipPct: 10, since: M }] });
    expect(planOwnershipShare('80', open, M, row))
      .toEqual({ kind: 'write', coOwners: [{ ...old, until: '2026-10' }, { ...old, id: row.id, ownershipPct: 20, since: M }] });
    // Back to the starting share restores the starting list, undoing an earlier commit.
    const back = planOwnershipShare('50', open, M, row);
    expect(back.kind === 'write' && back.coOwners).toBe(open);
  });

  it('a new co-owner owns since the move-in month', () => {
    expect(planOwnershipShare('60', [], M, row, '2022-05'))
      .toEqual({ kind: 'write', coOwners: [{ ...row, ownershipPct: 40, since: '2022-05' }] });
  });

  it("points to the Bolig page when the answer can't be written", () => {
    // A co-owner joining at 60 % next year would overlap any new co-owner over 40 %.
    const later: CoOwner = { id: 'later', name: 'B', ownershipPct: 60, since: '2027-06' };
    expect(planOwnershipShare('50', [later], M, row)).toEqual({ kind: 'elsewhere' });
    // Two current co-owners are richer than the question.
    const two: CoOwner[] = [{ ...old, id: 'a', ownershipPct: 20 }, { ...old, id: 'b', ownershipPct: 20 }];
    expect(planOwnershipShare('70', two, M, row)).toEqual({ kind: 'elsewhere' });
  });
});
