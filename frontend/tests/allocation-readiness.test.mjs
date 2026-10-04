import assert from "node:assert/strict";
import test from "node:test";
import { allocationBlockers } from "../lib/allocation-readiness.ts";

test("fuel and driver warnings do not appear as allocation blockers", () => {
  const result = allocationBlockers([
    { eligible: false, constraints: {
      fuel: { status: "unknown", blocking: false, message: "Not verified" },
      driver: { status: "unknown", blocking: false, message: "Not assigned" },
      weight: { status: "pass", message: "Load fits." },
    } },
    { eligible: false, constraints: {
      fuel: { status: "unknown", blocking: false, message: "Not verified" },
      weight: { status: "fail", message: "Required 6000 kg; capacity 5000 kg." },
    } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].constraint, "weight");
  assert.equal(result[0].status, "fail");
  assert.equal(result[0].vehicleCount, 1);
});

test("only explicit fuel failure blocks allocation", () => {
  const result = allocationBlockers([
    { eligible: true, constraints: { fuel: { status: "unknown", blocking: false, message: "Not verified" } } },
    { eligible: false, constraints: { fuel: { status: "fail", blocking: true, message: "Exceeded quota" } } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "fail");
});

test("a refreshed eligible vehicle no longer contributes blockers", () => {
  const refreshed = [{ eligible: true, constraints: { fuel: { status: "pass", message: "Within quota." } } }];
  assert.deepEqual(allocationBlockers(refreshed), []);
});

test("no depot vehicles yields no fabricated constraint reasons", () => {
  assert.deepEqual(allocationBlockers([]), []);
});

test("different backend reasons are retained for the same check", () => {
  const result = allocationBlockers([
    { eligible: false, constraints: { availability: { status: "fail", message: "VEH001 is allocated." } } },
    { eligible: false, constraints: { availability: { status: "fail", message: "VEH002 is unavailable." } } },
  ]);
  assert.equal(result[0].vehicleCount, 2);
  assert.deepEqual(result[0].messages, ["VEH001 is allocated.", "VEH002 is unavailable."]);
});
