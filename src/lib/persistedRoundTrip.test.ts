import { describe, it, expect } from 'vitest';
import {
  changedPaths, hasLegacyCopies, importAndSave, loadAndSave, shownBalance, undoRevision, type Blob,
} from './persistedRoundTrip.testHelpers';
import { changedKeys, revertChange } from '../../server/revert.js';

// An old blob and its revision history, taken through every path that touches a
// stored blob: load + autosave, undo of each past revision, restore of each past
// revision, and re-import of old files. The two undo bugs after the mortgage
// balance moved to assets.houseDebt (#280) lived in these seams, not in any one
// function. All figures are invented.

const P = 3_000_000; // the old untouched placeholder

type Mode = 'first_buyer' | 'homeowner' | 'transitioning';
interface Legacy { mode: Mode; debt: number; home: number; trans: number; asOf?: string }

// Every field the app persists, at its default: an old app's autosave wrote them
// all, so a stored revision holds them all.
const FULL = loadAndSave({});

/** `over` on top of the full default blob, object slices merged per field. */
function fullBlob(over: Blob): Blob {
  const out = structuredClone(FULL);
  for (const [k, v] of Object.entries(over)) {
    const base = out[k];
    out[k] = base && typeof base === 'object' && !Array.isArray(base) && v && typeof v === 'object' && !Array.isArray(v)
      ? { ...base, ...v } : v;
  }
  return out;
}

/** A synthetic blob in the old three-field shape. */
function legacyBlob({ mode, debt, home, trans, asOf }: Legacy): Blob {
  return fullBlob({
    income: 41_000,
    fixedExpenses: [{ id: 'fx-rent', name: 'Fellesutgifter', amount: 3_100, type: 'fixed' }],
    dailyTransactions: [],
    housingMode: mode,
    assets: { houseValue: 4_200_000, houseDebt: debt, portfolio: 75_000, savingsAccounts: [] },
    homeowner: {
      originalLoanAmount: 2_600_000, rente: 4.9, nedbetalingstid: 22, nedbetalingstidAsOf: '2025-11', termingebyr: 45,
      currentMortgageBalance: home, ...(asOf ? { currentMortgageBalanceAsOf: asOf } : {}),
    },
    transition: { currentHouseValue: 4_200_000, agentFeePercent: 2.5, currentMortgageBalance: trans },
  });
}

/** Each revision is the previous one with one edit applied. */
function history(first: Blob, ...edits: ((b: Blob) => void)[]): Blob[] {
  const out = [first];
  for (const edit of edits) {
    const next = structuredClone(out[out.length - 1]);
    edit(next);
    out.push(next);
  }
  return out;
}

const slice = (b: Blob, k: string) => b[k] as Blob;
const setBalance = (n: number, asOf: string) => (b: Blob) => {
  slice(b, 'assets').houseDebt = n;
  slice(b, 'homeowner').currentMortgageBalance = n;
  slice(b, 'homeowner').currentMortgageBalanceAsOf = asOf;
  slice(b, 'transition').currentMortgageBalance = n;
};

interface Fixture {
  name: string;
  history: Blob[];
  /** The balance the app showed at each revision, by the old rules. */
  shown: number[];
  /** The balance each stored snapshot month shows, wherever it appears. */
  snapshots?: Record<string, number>;
}

const FIXTURES: Fixture[] = [
  {
    name: 'homeowner, copies in sync',
    history: history(
      legacyBlob({ mode: 'homeowner', debt: 2_150_000, home: 2_150_000, trans: 2_150_000, asOf: '2026-02' }),
      setBalance(2_110_000, '2026-05'),
      (b) => { b.income = 42_500; },
      (b) => { slice(b, 'homeowner').rente = 4.6; },
    ),
    shown: [2_150_000, 2_110_000, 2_110_000, 2_110_000],
  },
  {
    name: 'transitioning, copies in sync',
    history: history(
      legacyBlob({ mode: 'transitioning', debt: 1_730_000, home: 1_730_000, trans: 1_730_000, asOf: '2026-03' }),
      setBalance(1_700_000, '2026-06'),
      (b) => { slice(b, 'transition').currentHouseValue = 4_350_000; },
      (b) => { b.income = 43_000; },
    ),
    shown: [1_730_000, 1_700_000, 1_700_000, 1_700_000],
  },
  {
    name: 'first_buyer, owner slices on the untouched placeholder',
    history: history(
      legacyBlob({ mode: 'first_buyer', debt: 380_000, home: P, trans: P }),
      (b) => { slice(b, 'assets').houseDebt = 365_000; },
      (b) => { b.income = 41_800; },
    ),
    shown: [380_000, 365_000, 365_000],
  },
  {
    name: 'homeowner, drifted copies',
    history: history(
      legacyBlob({ mode: 'homeowner', debt: 2_310_000, home: 2_270_000, trans: 2_290_000, asOf: '2026-01' }),
      (b) => { b.income = 39_900; },
      (b) => {
        slice(b, 'homeowner').currentMortgageBalance = 2_250_000;
        slice(b, 'homeowner').currentMortgageBalanceAsOf = '2026-04';
      },
      (b) => { slice(b, 'assets').portfolio = 81_000; },
      // An Assets edit to the copy the homeowner mode did not show.
      (b) => { slice(b, 'assets').houseDebt = 2_330_000; },
    ),
    shown: [2_270_000, 2_270_000, 2_250_000, 2_250_000, 2_250_000],
  },
  {
    name: 'homeowner, untouched placeholder until a balance is entered on Assets',
    history: history(
      legacyBlob({ mode: 'homeowner', debt: 0, home: P, trans: P }),
      (b) => { slice(b, 'assets').houseDebt = 1_840_000; },
      (b) => { b.income = 40_200; },
      // #218's legacy-term stamp also landed on the untouched placeholder.
      (b) => { slice(b, 'homeowner').currentMortgageBalanceAsOf = '2026-06'; },
    ),
    shown: [0, 1_840_000, 1_840_000, 1_840_000],
  },
  {
    name: 'homeowner, old-shape balance snapshots',
    history: history(
      {
        ...legacyBlob({ mode: 'homeowner', debt: 1_960_000, home: 1_960_000, trans: 1_960_000, asOf: '2026-07' }),
        balanceSnapshots: {
          '2026-06': {
            housingMode: 'homeowner', loan: {}, pension: {},
            assets: { houseValue: 4_100_000, houseDebt: 2_010_000, savings: 0, savingsAccounts: [] },
            homeowner: { rente: 4.9, nedbetalingstid: 22, currentMortgageBalance: 1_995_000, currentMortgageBalanceAsOf: '2026-06' },
            transition: { currentMortgageBalance: 2_020_000 },
          },
        },
      },
      (b) => {
        (b.balanceSnapshots as Blob)['2026-07'] = {
          housingMode: 'transitioning', loan: {}, pension: {},
          assets: { houseValue: 4_150_000, houseDebt: 1_970_000, savings: 0, savingsAccounts: [] },
          homeowner: { rente: 4.9, nedbetalingstid: 22, currentMortgageBalance: 1_980_000, currentMortgageBalanceAsOf: '2026-07' },
          transition: { currentMortgageBalance: 1_975_000 },
        };
      },
      setBalance(1_940_000, '2026-09'),
    ),
    shown: [1_960_000, 1_960_000, 1_940_000],
    snapshots: { '2026-06': 1_995_000, '2026-07': 1_975_000 },
  },
];

/** What every blob the app ends up holding must satisfy. */
function expectSound(view: Blob, f: Fixture) {
  expect(hasLegacyCopies(view)).toBe(false);
  const balance = shownBalance(view);
  expect(Number.isFinite(balance)).toBe(true);
  expect(slice(view, 'assets').houseDebt).toBe(balance);
  expect(loadAndSave(view)).toEqual(view); // loading again changes nothing
  for (const [month, snap] of Object.entries((view.balanceSnapshots ?? {}) as Blob)) {
    expect(shownBalance(snap), `snapshot ${month}`).toBe(f.snapshots?.[month]);
  }
}

const valueAt = (b: Blob, path: string) => {
  const [k, f] = path.split('.');
  return f === undefined ? b[k] : (b[k] as Blob | undefined)?.[f];
};
const same = (a: unknown, b: unknown) => changedPaths({ v: a }, { v: b }).length === 0;

describe.each(FIXTURES)('persisted shape round trip: $name', (f) => {
  const H = f.history;
  const n = H.length;
  // What the app holds after loading each revision: the user's view of history.
  const L = H.map(loadAndSave);
  // Loading the newest legacy blob autosaves the migrated blob as revision n.
  const M = L[n - 1];
  const revisions = [...H, M];
  const views = [...L, M];

  it('every revision loads to the balance the app showed then, in the new shape', () => {
    L.forEach((view, k) => {
      expectSound(view, f);
      expect(shownBalance(view), `revision ${k}`).toBe(f.shown[k]);
    });
  });

  it('the migration save changes only the mortgage slices, and loading the old blob again agrees', () => {
    for (const p of changedPaths(H[n - 1], M)) {
      expect(['assets', 'homeowner', 'transition'].some((s) => p.startsWith(`${s}.`)), p).toBe(true);
    }
    expect(loadAndSave(H[n - 1])).toEqual(M);
  });

  for (let k = 1; k < revisions.length; k++) {
    it(`undo of revision ${k} applies cleanly or conflicts only on a field changed since`, () => {
      const r = undoRevision(M, revisions, k);
      // Fields that revision changed, as the user saw them, and which of those
      // the user changed again afterwards.
      const touched = changedPaths(views[k - 1], views[k]);
      const since = touched.filter((p) => !same(valueAt(views[k], p), valueAt(M, p)));
      if (since.length === 0) {
        expect(r.conflicts, `undo of ${k}`).toBeUndefined();
        const view = loadAndSave(r.blob!);
        expectSound(view, f);
        // The touched fields go back to what they were before that revision ...
        for (const p of touched) expect(valueAt(view, p), p).toEqual(valueAt(views[k - 1], p));
        // ... and the balance shown follows them, or stays as it is.
        const balanceTouched = shownBalance(views[k - 1]) !== shownBalance(views[k]);
        expect(shownBalance(view)).toBe(balanceTouched ? shownBalance(views[k - 1]) : shownBalance(M));
      } else {
        expect(r.conflicts, `undo of ${k}`).toBeDefined();
        for (const c of r.conflicts!) expect(since.some((p) => c === p || c.startsWith(`${p}[`)), c).toBe(true);
      }
    });
  }

  for (let k = 0; k < n; k++) {
    it(`restore of revision ${k} shows that revision's balance`, () => {
      // The server writes the old blob verbatim; the client loads and autosaves it.
      const restored = loadAndSave(H[k]);
      expectSound(restored, f);
      expect(shownBalance(restored)).toBe(f.shown[k]);
    });

    it(`undo of the restore of revision ${k} goes back to the state before it`, () => {
      const restored = loadAndSave(H[k]);
      // Undo the restore revision (M → H[k]) against the autosaved state.
      const r = revertChange(restored, H[k], M, changedKeys(M, H[k]));
      expect(r.conflicts).toBeUndefined();
      const back = loadAndSave(r.blob!);
      expectSound(back, f);
      expect(shownBalance(back)).toBe(shownBalance(M));
    });

    it(`importing the legacy file of revision ${k} over the migrated state, and undoing the import`, () => {
      const imported = importAndSave(M, H[k]);
      expectSound(imported, f);
      expect(shownBalance(imported)).toBe(f.shown[k]);
      // Undo the import revision (M → imported) against itself.
      const r = revertChange(imported, imported, M, changedKeys(M, imported));
      expect(r.conflicts).toBeUndefined();
      expect(loadAndSave(r.blob!)).toEqual(M);
    });
  }
});

describe('BSU total deposited (optional assets field)', () => {
  const withDeposited = fullBlob({ assets: { bsu: 120_000, bsuTotalDeposited: 110_000 } });

  it('a blob without it loads and saves without adding it', () => {
    const saved = loadAndSave(fullBlob({ assets: { bsu: 120_000 } }));
    expect('bsuTotalDeposited' in slice(saved, 'assets')).toBe(false);
  });

  it('survives load, autosave and a second load', () => {
    const saved = loadAndSave(withDeposited);
    expect(slice(saved, 'assets').bsuTotalDeposited).toBe(110_000);
    expect(loadAndSave(saved)).toEqual(saved);
  });

  it('importing a file that carries it applies it, and undoing the import removes it', () => {
    const base = loadAndSave(fullBlob({ assets: { bsu: 120_000 } }));
    const imported = importAndSave(base, withDeposited);
    expect(slice(imported, 'assets').bsuTotalDeposited).toBe(110_000);
    const r = revertChange(imported, imported, base, changedKeys(base, imported));
    expect(r.conflicts).toBeUndefined();
    expect(loadAndSave(r.blob!)).toEqual(base);
  });
});

describe("a fixed expense's uncovered months (optional field)", () => {
  const expense = { id: 'fx-loan', name: 'Lån', amount: 9_000, type: 'fixed', destinationKind: 'mortgage', lastPostedMonth: '2026-07' };
  const withUncovered = fullBlob({ fixedExpenses: [{ ...expense, uncoveredMonths: { '2026-05': 0, '2026-06': 3000 } }] });

  it('a blob without it loads and saves without adding it', () => {
    const saved = loadAndSave(fullBlob({ fixedExpenses: [expense] }));
    expect('uncoveredMonths' in (saved.fixedExpenses as Blob[])[0]).toBe(false);
  });

  it('survives load, autosave and a second load', () => {
    const saved = loadAndSave(withUncovered);
    expect((saved.fixedExpenses as Blob[])[0].uncoveredMonths).toEqual({ '2026-05': 0, '2026-06': 3000 });
    expect(loadAndSave(saved)).toEqual(saved);
  });
});

// Pension auto-post switched on before switching on stamped the month never
// posted. Load and import stamp it to now (NOW = 2026-10) with the OTP bonus
// share earned so far counted as already in the balance.
describe('pension auto-post stamp on load and import', () => {
  const pay = {
    salaries: [{ id: 's', jobId: 'j', effectiveDate: '2025-01', grossAnnual: 600_000, changeType: 'initial' }],
    jobs: [{ id: 'j', startDate: '2025-01', endDate: null, employer: 'Employer', role: 'Role', contractedHoursPerWeek: 37.5 }],
    bonuses: [{ id: 'b', date: '2026-03-01', amount: 100_000, type: 'annual' }],
  };
  const unstamped = { otpAutoPost: true, ipsAutoPost: true, otpEmployerPct: 5, otpEmployeePct: 0, otpIncludesBonuses: true };

  it('load stamps both and records the bonus baseline', () => {
    const p = slice(loadAndSave(fullBlob({ ...pay, pension: unstamped })), 'pension');
    expect(p.otpLastPostedMonth).toBe('2026-10');
    expect(p.ipsLastPostedMonth).toBe('2026-10');
    expect(p.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 5_000 });
  });

  it('an import of only the pension reads pay and bonuses from the current state', () => {
    // The "included" section restore carries pension but not salaries, jobs or bonuses.
    const state = loadAndSave(fullBlob(pay));
    const p = slice(importAndSave(state, { pension: unstamped }), 'pension');
    expect(p.otpLastPostedMonth).toBe('2026-10');
    expect(p.otpBonusPostedByYear).toEqual({ '2025': 0, '2026': 5_000 });
  });

  it('an existing stamp is left alone', () => {
    const p = slice(loadAndSave(fullBlob({ ...pay, pension: { ...unstamped, otpLastPostedMonth: '2026-01', ipsLastPostedMonth: '2026-01' } })), 'pension');
    expect(p.otpLastPostedMonth).toBe('2026-01');
    expect(p.otpBonusPostedByYear).toEqual({ '2026': 500 }); // the stored record, untouched
  });
});

describe("departed paydown stamps (optional assets field)", () => {
  const departed = { mortgage: { lastPostedMonth: '2026-06', uncoveredMonths: { '2026-05': 0 } }, 'debt:car': { lastPostedMonth: '2026-04' } };

  it('a blob without it loads and saves without adding it', () => {
    const saved = loadAndSave(fullBlob({ assets: { bsu: 120_000 } }));
    expect('departedPaydowns' in slice(saved, 'assets')).toBe(false);
  });

  it('survives load, autosave and a second load', () => {
    const saved = loadAndSave(fullBlob({ assets: { bsu: 120_000, departedPaydowns: departed } }));
    expect(slice(saved, 'assets').departedPaydowns).toEqual(departed);
    expect(loadAndSave(saved)).toEqual(saved);
  });
});

// A saving or paydown expense created from the savings allocation carries the
// plan row's id, which is what "Sync amounts" matches on. Losing it on any path
// would quietly turn an allocation-made transfer into a hand-made one.
describe('allocationId on savings and fixed expenses', () => {
  const blob = fullBlob({
    income: 41_000,
    dailyTransactions: [],
    savings: [{ id: 'sv-a', name: 'Fond', amount: 3_000, mode: 'amount', destinationKind: 'portfolio', allocationId: 'al-1' }],
    fixedExpenses: [{ id: 'fx-a', name: 'Lån', amount: 800, type: 'fixed', destinationKind: 'mortgage', allocationId: 'al-2' }],
  });
  const ids = (b: Blob) => [
    (b.savings as { allocationId?: string }[])[0].allocationId,
    (b.fixedExpenses as { allocationId?: string }[])[0].allocationId,
  ];

  it('survives load and autosave', () => {
    expect(ids(loadAndSave(blob))).toEqual(['al-1', 'al-2']);
  });

  it('survives import', () => {
    expect(ids(importAndSave(FULL, blob))).toEqual(['al-1', 'al-2']);
  });
});
