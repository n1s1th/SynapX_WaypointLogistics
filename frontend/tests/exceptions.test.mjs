import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../components/dispatcher/operations/exceptions.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const { shipmentExceptions, timestamp, fetchShipments } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const now = Date.parse('2026-10-03T12:00:00Z');
const shipment = (id, status, trip = {}) => ({ id, tracking_number: `S${id}`, order_id: id, status, current_location: null, last_updated: '2026-10-03T10:00:00', dispatch_trip: { trip_code: 'T1', driver_name: 'Driver', vehicle_number: 'V1', destination: 'Depot', estimated_arrival: '2026-10-03T11:00:00', actual_arrival: null, ...trip } });
test('failure precedence; terminal, arrived, missing, future, and exact ETA excluded', () => {
  const result = shipmentExceptions([shipment(1, 'failed'), shipment(2, 'in_transit'), shipment(3, 'delivered'), shipment(4, 'pending', { actual_arrival: '2026-10-03T11:30:00' }), shipment(5, 'pending', { estimated_arrival: null }), shipment(6, 'pending', { estimated_arrival: '2026-10-03T12:00:00Z' }), shipment(7, 'out_for_delivery', { estimated_arrival: '2026-10-04T12:00:00Z' })], now);
  assert.deepEqual(result.map(e => [e.shipment.id, e.kind]), [[1, 'failed'], [2, 'eta']]);
  assert.equal(timestamp('2026-10-03T12:00:00'), now);
  assert.equal(timestamp('2026-10-03T17:30:00+05:30'), now);
});
test('pagination loads all, rejects errors, malformed records and repeated pages', async () => {
  const original = global.fetch;
  const records = Array.from({ length: 101 }, (_, i) => shipment(i, 'failed'));
  try {
    global.fetch = async url => { const skip = Number(new URL(url).searchParams.get('skip')); return Response.json(records.slice(skip, skip + 100)); };
    assert.equal((await fetchShipments(new AbortController().signal)).length, 101);
    global.fetch = async () => Response.json(records.slice(0, 100));
    await assert.rejects(fetchShipments(new AbortController().signal), /did not advance/);
    global.fetch = async () => Response.json([shipment(1, 'failed', { estimated_arrival: 'bad' })]);
    await assert.rejects(fetchShipments(new AbortController().signal), /invalid records/);
    global.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(fetchShipments(new AbortController().signal), /503/);
  } finally { global.fetch = original; }
});
