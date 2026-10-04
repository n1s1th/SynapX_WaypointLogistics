import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Load the pure TS calculations without adding a test-runner dependency.
const filename = new URL('../components/dispatcher/operations/data.ts', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const { groupDestinations, orderDay, forecastOrders, dailyCounts, csvText, fetchOrders } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const order = (id, date, overrides = {}) => ({ id, order_number: `ORD-${id}`, client_name: 'Store A', destination_address: 'Main Road', status: 'confirmed', items: [], created_at: date, ...overrides });

test('destination grouping normalizes whitespace/case without merging distinct addresses', () => {
  const groups = groupDestinations([order(1, '2026-09-01T00:00:00'), order(2, '2026-09-02T00:00:00', { client_name: ' store   A ', status: 'delivered' }), order(3, '2026-09-03T00:00:00', { destination_address: 'Other Road', status: 'cancelled' })]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].orders.length, 2);
  assert.equal(groups[0].open, 1);
  assert.equal(groups[0].delivered, 1);
  assert.equal(groups[1].open, 0);
});
test('naive backend timestamps are UTC and roll over correctly in Colombo', () => {
  assert.equal(orderDay('2026-09-30T19:00:00'), '2026-10-01');
  assert.equal(orderDay('2026-09-30T19:00:00Z'), '2026-10-01');
  assert.equal(orderDay('2026-10-01T00:30:00+05:30'), '2026-10-01');
  assert.equal(orderDay('invalid'), '');
});
test('forecast excludes today/future and uses every calendar day in denominator', () => {
  const orders = [order(1, '2026-09-05T00:00:00Z'), order(2, '2026-09-06T00:00:00Z'), order(3, '2026-10-03T00:00:00Z'), order(4, '2026-10-04T00:00:00Z')];
  const result = forecastOrders(orders, '2026-10-03', 28, 7);
  assert.equal(result.eligible, true);
  assert.equal(result.total, 2);
  assert.equal(result.mean, 2 / 28);
  assert.equal(result.predictions[0].day, '2026-10-04');
  assert.equal(result.predictions.at(-1).day, '2026-10-10');
  assert.equal(result.days.length, 28);
});
test('empty, short, or stale-only history cannot produce forecasts', () => {
  for (const orders of [[], [order(1, '2026-10-02T00:00:00Z')], [order(1, '2025-01-01T00:00:00Z')]]) {
    assert.equal(forecastOrders(orders, '2026-10-03', 28, 7).eligible, false);
  }
  assert.deepEqual(dailyCounts([], '2026-09-30', '2026-10-01'), [{ day: '2026-09-30', count: 0 }, { day: '2026-10-01', count: 0 }]);
});
test('CSV escapes delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(csvText([['a,"b', '=1+1', '  @SUM(A1)', 42]]), '"a,""b","\'=1+1","\'  @SUM(A1)","42"');
});
test('API pagination loads all pages and rejects repeated pages', async () => {
  const original = global.fetch;
  const batch = Array.from({ length: 100 }, (_, i) => order(i, '2026-09-01T00:00:00Z'));
  const requests = [];
  try {
    global.fetch = async url => { requests.push(url); return { ok: true, json: async () => requests.length === 1 ? batch : [order(100, '2026-09-02T00:00:00Z')] }; };
    assert.equal((await fetchOrders(new AbortController().signal)).length, 101);
    assert.match(requests[1], /skip=100/);
    global.fetch = async () => ({ ok: true, json: async () => batch });
    await assert.rejects(fetchOrders(new AbortController().signal), /did not advance/);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(fetchOrders(new AbortController().signal), /503/);
  } finally { global.fetch = original; }
});
