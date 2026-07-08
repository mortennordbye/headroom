// Concrete hex mirrors of the CSS theme tokens in src/index.css. Recharts (and
// raw SVG) set colours as SVG attributes, which do NOT resolve `var(--…)`, so
// charts must use literal values. Keep these in sync with src/index.css.
export const CHART = {
  forest: '#1F5A42',       // --forest
  forestLight: '#7FCBA0',  // --forest-light / --positive
  teal: '#3F7373',         // --teal
  slate: '#5B7280',        // --slate
  rust: '#B5533A',         // --rust / --negative
  brass: '#C9A24A',        // --brass / --warning
  text1: '#ECE7D8',        // --text / --text-1
  textDim: '#767C6B',      // --text-dim / --text-3
  textSoft: '#9A9C8C',     // --text-soft / --text-2
  bgCard: '#141712',       // --bg-2 / --bg-card
  bg3: '#191D16',          // --bg-3
  rule: '#262A20',         // --rule / --border
  grid: 'rgba(236,231,216,0.06)',
  track: 'rgba(236,231,216,0.05)',
} as const;

// Categorical series colour order (matches the 4 category hues + accents).
export const SERIES = [CHART.teal, CHART.forest, CHART.slate, CHART.forestLight, CHART.brass, CHART.rust];

// Shared Recharts prop blocks — the one axis/grid treatment every chart uses.
// Spread them (`<XAxis {...AXIS_PROPS} …>`, `<YAxis {...AXIS_PROPS_Y} …>`,
// `<CartesianGrid {...GRID_PROPS} …>`); per-chart extras (width, tickFormatter,
// vertical, domain) stay as ordinary props after the spread. Deliberate
// exceptions (emphasised year axes, category labels) keep their own tick.
export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: CHART.textSoft },
  axisLine: false,
  tickLine: false,
} as const;
export const AXIS_PROPS_Y = {
  tick: { fontSize: 10, fill: CHART.textDim },
  axisLine: false,
  tickLine: false,
} as const;
export const GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: CHART.grid,
} as const;
