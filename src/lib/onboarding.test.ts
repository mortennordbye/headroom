import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_TOPICS,
  ONBOARDING_TOPIC_COUNT,
  ONBOARDING_GROUPS,
  topicsInGroup,
  topicById,
  topicIndex,
  nextTopic,
} from './onboarding';

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
    const writers = new Set(['lang', 'region', 'income', 'savingsTarget', 'asset', 'pension', 'growthRate']);
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
