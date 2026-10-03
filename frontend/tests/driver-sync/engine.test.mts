/**
 * Driver offline sync engine tests.
 *
 *   npm run test:driver-sync
 *
 * Uses Node's built-in test runner with type stripping (no extra
 * dependencies). Storage is an in-memory stand-in for IndexedDB that outlives
 * each "app session", and the fake server keeps an idempotency ledger like
 * the real /driver/sync endpoint.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_ATTEMPTS,
  TransportError,
  completionBlockers,
  localStopState,
  localTripCompletion,
  resetForRetry,
  runFlush,
  selectSendable,
  type FlushDeps,
  type QueuedAction,
  type ServerResult,
  type SyncRequest,
} from "../../lib/driverSync/engine.ts";

const DRIVER = 7;
const TRIP = 12;
let clock = Date.parse("2026-10-03T05:00:00Z");
let seq = 0;

function action(over: Partial<QueuedAction> = {}): QueuedAction {
  seq++;
  return {
    action_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    action_type: "deliver",
    trip_id: TRIP,
    stop_id: 1,
    driver_id: DRIVER,
    payload: { outcome: "delivered", recipient_name: "Malini", signature_data: "data:image/png;base64,AAA" },
    client_timestamp: new Date(clock + seq * 1000).toISOString(),
    label: `record ${seq}`,
    sync_status: "PENDING_SYNC",
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    error_code: null,
    retryable: true,
    photo_keys: [],
    uploaded: {},
    server: null,
    synced_at: null,
    ...over,
  };
}

/** IndexedDB stand-in: survives across "sessions" like the real database. */
class Device {
  actions = new Map<string, QueuedAction>();
  blobs = new Map<string, Blob>();

  put(a: QueuedAction, photos: Record<string, Blob> = {}) {
    for (const [k, b] of Object.entries(photos)) this.blobs.set(k, b);
    this.actions.set(a.action_id, { ...a, photo_keys: [...a.photo_keys, ...Object.keys(photos)] });
  }
  get(id: string) {
    return this.actions.get(id)!;
  }
}

type Outcome = "applied" | "conflict" | "rejected";

/** The backend's behaviour that matters to the phone. */
class FakeServer {
  ledger = new Map<string, ServerResult>();
  files = new Map<string, string>();
  online = true;
  sessionValid = true;
  /** Commit the next record, then drop the response (lost on the way back). */
  loseNextResponse = false;
  failNextWith500 = 0;
  decide: (r: SyncRequest) => { status: Outcome; code?: string; message?: string } = () => ({ status: "applied" });
  received: SyncRequest[] = [];
  uploads = 0;

  async upload(_blob: Blob, fileId: string): Promise<string> {
    if (!this.online) throw new TransportError("network", 0, "offline");
    if (!this.sessionValid) throw new TransportError("auth", 403, "Could not validate credentials");
    this.uploads++;
    const url = this.files.get(fileId) ?? `/static/uploads/${fileId.replace(/-/g, "")}.jpg`;
    this.files.set(fileId, url);
    return url;
  }

  async send(r: SyncRequest): Promise<ServerResult> {
    if (!this.online) throw new TransportError("network", 0, "offline");
    if (!this.sessionValid) throw new TransportError("auth", 403, "Could not validate credentials");
    if (this.failNextWith500 > 0) {
      this.failNextWith500--;
      throw new TransportError("server", 500, "Database unavailable");
    }
    this.received.push(r);
    const prior = this.ledger.get(r.action_id);
    let result: ServerResult;
    if (prior) {
      result = { ...prior, duplicate: true };
    } else {
      const d = this.decide(r);
      result = {
        action_id: r.action_id, status: d.status, duplicate: false, code: d.code ?? null, message: d.message ?? null,
        trip_id: r.trip_id, stop_id: r.stop_id, server_state: null, received_at: new Date(clock).toISOString(),
        reviewed: false, review_note: null,
      };
      this.ledger.set(r.action_id, result);
    }
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new TransportError("network", 0, "connection reset");
    }
    return result;
  }

  appliedFor(stopId: number) {
    return [...this.ledger.values()].filter((r) => r.stop_id === stopId && r.status === "applied").length;
  }
}

function deps(device: Device, server: FakeServer, driverId: number | null = DRIVER): FlushDeps {
  return {
    list: async () => [...device.actions.values()],
    save: async (a) => void device.actions.set(a.action_id, a),
    getBlob: async (k) => device.blobs.get(k),
    deleteBlob: async (k) => void device.blobs.delete(k),
    upload: (b, k) => server.upload(b, k),
    send: (r) => server.send(r),
    now: () => clock,
    driverId,
    random: () => 0.5,
  };
}

const photo = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

// ─── Scenarios ────────────────────────────────────────────────────────────────

test("2. store 1 synced online stays delivered; store 2 recorded offline waits and keeps its local outcome", async () => {
  const device = new Device();
  const server = new FakeServer();
  const s1 = action({ stop_id: 1 });
  device.put(s1, { "11111111-1111-4111-8111-111111111111": photo() });
  assert.equal((await runFlush(deps(device, server))).synced, 1);

  server.online = false; // signal lost at store 2
  const s2 = action({ stop_id: 2, payload: { outcome: "partial", delivered_items: { A: 3 } } });
  device.put(s2, { "22222222-2222-4222-8222-222222222222": photo() });
  const offline = await runFlush(deps(device, server));
  assert.equal(offline.stoppedBy, "network");
  assert.equal(device.get(s2.action_id).sync_status, "PENDING_SYNC");
  assert.equal(device.blobs.size, 1, "store 2 photo kept on the phone; store 1 photo released after sync");

  // Server still says store 1 delivered, store 2 pending: the overlay keeps both truthful
  const queue = [...device.actions.values()];
  assert.deepEqual(localStopState({ id: 1, status: "delivered" }, queue).sync, null);
  const local2 = localStopState({ id: 2, status: "pending" }, queue);
  assert.equal(local2.status, "partial", "partial is never shown as delivered");
  assert.equal(local2.sync, "PENDING_SYNC");
});

test("3. any pending store can be completed out of sequence; records go oldest first", async () => {
  const device = new Device();
  const server = new FakeServer();
  const s3 = action({ stop_id: 3 });
  const s2 = action({ stop_id: 2 });
  device.put(s2);
  device.put(s3);
  await runFlush(deps(device, server));
  assert.deepEqual(server.received.map((r) => r.stop_id), [3, 2]);
  assert.equal(device.get(s3.action_id).sync_status, "SYNCED");
});

test("4. records survive a reload, including one interrupted mid-sync", async () => {
  const device = new Device();
  const server = new FakeServer();
  const crashed = action({ stop_id: 1, sync_status: "SYNCING" }); // app killed during upload
  const waiting = action({ stop_id: 2 });
  device.put(crashed, { "33333333-3333-4333-8333-333333333333": photo() });
  device.put(waiting);

  // A brand-new app session over the same device storage
  const summary = await runFlush(deps(device, server));
  assert.equal(summary.synced, 2);
  assert.equal(device.blobs.size, 0);
});

test("5. photos upload before the record; the record carries their URLs; evidence is released only after SYNCED", async () => {
  const device = new Device();
  const server = new FakeServer();
  const key = "44444444-4444-4444-8444-444444444444";
  const a = action();
  device.put(a, { [key]: photo() });

  server.decide = (r) => {
    assert.deepEqual(r.payload.photo_urls, [server.files.get(key)]);
    return { status: "applied" };
  };
  await runFlush(deps(device, server));
  const saved = device.get(a.action_id);
  assert.equal(saved.sync_status, "SYNCED");
  assert.equal(saved.payload.signature_data, undefined, "signature removed from the phone once confirmed");
  assert.equal(device.blobs.has(key), false);
});

test("6. server commits but the response is lost: the retry is a duplicate, never a second delivery", async () => {
  const device = new Device();
  const server = new FakeServer();
  const key = "55555555-5555-4555-8555-555555555555";
  const a = action();
  device.put(a, { [key]: photo() });

  server.loseNextResponse = true;
  const first = await runFlush(deps(device, server));
  assert.equal(first.stoppedBy, "network");
  assert.equal(device.get(a.action_id).sync_status, "PENDING_SYNC", "not SYNCED without a confirmation");
  assert.ok(device.blobs.has(key), "evidence kept until confirmed");

  await runFlush(deps(device, server));
  const saved = device.get(a.action_id);
  assert.equal(saved.sync_status, "SYNCED");
  assert.equal(saved.server?.duplicate, true);
  assert.equal(server.appliedFor(1), 1);
  assert.equal(server.uploads, 1, "photo not re-uploaded: progress was saved");
});

test("7. one rejected record never blocks the others; a 500 is retried with bounded backoff", async () => {
  const device = new Device();
  const server = new FakeServer();
  const ok1 = action({ stop_id: 1 });
  const bad = action({ stop_id: 2 });
  const ok3 = action({ stop_id: 3 });
  [ok1, bad, ok3].forEach((a) => device.put(a));
  server.decide = (r) => (r.stop_id === 2 ? { status: "rejected", code: "SIGNATURE_REQUIRED", message: "Recipient signature is required." } : { status: "applied" });

  const summary = await runFlush(deps(device, server));
  assert.deepEqual([summary.synced, summary.rejected], [2, 1]);
  const failed = device.get(bad.action_id);
  assert.equal(failed.sync_status, "SYNC_FAILED");
  assert.equal(failed.retryable, false);
  assert.equal(failed.error_code, "SIGNATURE_REQUIRED");
  assert.equal(failed.last_error, "Recipient signature is required.");

  // Transient server error → retry later, not immediately
  const flaky = action({ stop_id: 4 });
  device.put(flaky);
  server.failNextWith500 = 1;
  await runFlush(deps(device, server));
  const waiting = device.get(flaky.action_id);
  assert.equal(waiting.sync_status, "SYNC_FAILED");
  assert.equal(waiting.retryable, true);
  assert.equal(selectSendable([...device.actions.values()], clock, DRIVER).length, 0, "not resent before backoff");
  clock = waiting.next_attempt_at!;
  await runFlush(deps(device, server));
  assert.equal(device.get(flaky.action_id).sync_status, "SYNCED");

  // Bounded: after MAX_AUTO_ATTEMPTS it waits for a manual retry
  const stuck = action({ stop_id: 5, sync_status: "SYNC_FAILED", retryable: true, attempts: MAX_AUTO_ATTEMPTS, next_attempt_at: 0 });
  device.put(stuck);
  assert.equal(selectSendable([stuck], clock, DRIVER).length, 0);
  assert.equal(selectSendable([resetForRetry(stuck)], clock, DRIVER).length, 1);
});

test("8. missing POD evidence: a lost local photo or a server rejection keeps the record for the driver", async () => {
  const device = new Device();
  const server = new FakeServer();
  const lost = action({ stop_id: 1, photo_keys: ["66666666-6666-4666-8666-666666666666"] }); // blob gone
  device.actions.set(lost.action_id, lost);
  const noPhoto = action({ stop_id: 2 });
  device.put(noPhoto);
  server.decide = (r) => (r.stop_id === 2 ? { status: "rejected", code: "PHOTO_REQUIRED", message: "At least one delivery photo is required." } : { status: "applied" });

  await runFlush(deps(device, server));
  assert.equal(device.get(lost.action_id).sync_status, "SYNC_FAILED");
  assert.match(device.get(lost.action_id).last_error!, /photo is missing/);
  assert.equal(server.received.some((r) => r.stop_id === 1), false, "never sent without its evidence");
  assert.equal(device.get(noPhoto.action_id).error_code, "PHOTO_REQUIRED");
  // A rejected delivery leaves the stop open so it can be recorded again
  const local = localStopState({ id: 2, status: "pending" }, [...device.actions.values()]);
  assert.deepEqual([local.status, local.sync], ["pending", "SYNC_FAILED"]);
});

test("9. expired session: nothing is lost, sync resumes after sign-in", async () => {
  const device = new Device();
  const server = new FakeServer();
  const a = action();
  const b = action({ stop_id: 2 });
  device.put(a);
  device.put(b);

  server.sessionValid = false;
  const blocked = await runFlush(deps(device, server));
  assert.equal(blocked.stoppedBy, "auth");
  assert.equal(device.get(a.action_id).sync_status, "PENDING_SYNC");
  assert.equal(device.get(a.action_id).error_code, "AUTH_REQUIRED");
  assert.equal(device.get(b.action_id).sync_status, "PENDING_SYNC");

  assert.equal((await runFlush(deps(device, server, null))).stoppedBy, "auth", "signed out: nothing is sent");

  server.sessionValid = true;
  assert.equal((await runFlush(deps(device, server))).synced, 2);
});

test("10. a conflict keeps the evidence, is never retried automatically, and shows on the stop", async () => {
  const device = new Device();
  const server = new FakeServer();
  const key = "77777777-7777-4777-8777-777777777777";
  const a = action({ stop_id: 2 });
  device.put(a, { [key]: photo() });
  server.decide = () => ({ status: "conflict", code: "STOP_REMOVED", message: "Dispatch removed this stop from your run." });

  await runFlush(deps(device, server));
  const saved = device.get(a.action_id);
  assert.equal(saved.sync_status, "CONFLICT");
  assert.ok(device.blobs.has(key), "photo kept for review");
  assert.ok(saved.payload.signature_data, "signature kept for review");
  assert.equal(selectSendable([saved], clock, DRIVER).length, 0);
  assert.equal(resetForRetry(saved).sync_status, "CONFLICT", "manual retry cannot bypass review");
  assert.equal(localStopState({ id: 2, status: "rescheduled" }, [saved]).sync, "CONFLICT");
});

test("11. another driver's records are never sent from this session", async () => {
  const device = new Device();
  const server = new FakeServer();
  device.put(action({ driver_id: 99 }));
  const summary = await runFlush(deps(device, server));
  assert.equal(summary.attempted, 0);
  assert.equal(server.received.length, 0);
});

test("12. trip completion waits for every stop record, stays pending until the server confirms", async () => {
  const device = new Device();
  const server = new FakeServer();
  const s1 = action({ stop_id: 1 });
  const done = action({ action_type: "complete_trip", stop_id: null, payload: {} });
  const s2 = action({ stop_id: 2 }); // recorded after tapping complete
  device.put(s1);
  device.put(done);
  device.put(s2);

  assert.deepEqual(completionBlockers([...device.actions.values()], TRIP).length, 2);
  assert.ok(!selectSendable([...device.actions.values()], clock, DRIVER).includes(done));
  assert.equal(localTripCompletion(TRIP, [...device.actions.values()])?.sync_status, "PENDING_SYNC");

  server.online = false;
  await runFlush(deps(device, server));
  assert.equal(device.get(done.action_id).sync_status, "PENDING_SYNC", "locally complete, not confirmed");

  server.online = true;
  await runFlush(deps(device, server)); // sends the stops; completion still held this pass
  await runFlush(deps(device, server)); // now nothing blocks it
  assert.equal(device.get(done.action_id).sync_status, "SYNCED");
  const order = server.received.map((r) => r.action_type);
  assert.equal(order[order.length - 1], "complete_trip");
});
