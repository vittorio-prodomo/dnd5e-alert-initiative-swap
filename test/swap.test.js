// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import {
  getAlertFeat, hasAlert, isIncapacitated, isWindowOpen,
  getSwapCandidates, swapInitiative, pickResponsibleUser,
} from "../scripts/swap.js";

const mkActor = ({ items = [], statuses = [], perm } = {}) => ({
  items,
  statuses: new Set(statuses),
  testUserPermission: perm ?? (() => false),
});
const mkCombatant = ({ id, initiative = null, disposition = 1, actor = mkActor() } = {}) =>
  ({ id, initiative, token: { disposition, name: id }, actor });

test("getAlertFeat / hasAlert match by identifier and name", () => {
  const byId = mkActor({ items: [{ type: "feat", system: { identifier: "alert" }, name: "X" }] });
  const byName = mkActor({ items: [{ type: "feat", system: {}, name: "Alert" }] });
  const none = mkActor({ items: [{ type: "feat", system: { identifier: "lucky" }, name: "Lucky" }] });
  assert.ok(getAlertFeat(byId));
  assert.ok(getAlertFeat(byName));
  assert.equal(getAlertFeat(none), null);
  assert.equal(hasAlert(byId), true);
  assert.equal(hasAlert(none), false);
});

test("isIncapacitated reads the status set", () => {
  assert.equal(isIncapacitated(mkActor({ statuses: ["incapacitated"] })), true);
  assert.equal(isIncapacitated(mkActor()), false);
});

test("isWindowOpen requires unstarted combat, rolled + non-incapacitated owner", () => {
  const owner = mkCombatant({ id: "o", initiative: 12 });
  assert.equal(isWindowOpen({ started: false }, owner), true);
  assert.equal(isWindowOpen({ started: true }, owner), false);
  assert.equal(isWindowOpen({ started: false }, mkCombatant({ id: "o", initiative: null })), false);
  assert.equal(isWindowOpen(null, owner), false);
  const incap = mkCombatant({ id: "o", initiative: 12, actor: mkActor({ statuses: ["incapacitated"] }) });
  assert.equal(isWindowOpen({ started: false }, incap), false);
});

test("getSwapCandidates filters disposition/rolled/incapacitation and excludes self", () => {
  const owner = mkCombatant({ id: "o", initiative: 10, disposition: 1 });
  const ally = mkCombatant({ id: "a", initiative: 15, disposition: 1 });
  const unrolled = mkCombatant({ id: "b", initiative: null, disposition: 1 });
  const enemy = mkCombatant({ id: "e", initiative: 20, disposition: -1 });
  const incap = mkCombatant({ id: "c", initiative: 5, disposition: 1, actor: mkActor({ statuses: ["incapacitated"] }) });
  const combat = { combatants: [owner, ally, unrolled, enemy, incap] };
  assert.deepEqual(getSwapCandidates(combat, owner).map((c) => c.id), ["a"]);
});

test("swapInitiative exchanges values in one update; guards started/unrolled", async () => {
  const calls = [];
  const combat = { started: false, updateEmbeddedDocuments: async (t, d) => { calls.push([t, d]); } };
  const a = mkCombatant({ id: "a", initiative: 8 });
  const b = mkCombatant({ id: "b", initiative: 19 });
  const res = await swapInitiative(combat, a, b);
  assert.deepEqual(calls, [["Combatant", [{ _id: "a", initiative: 19 }, { _id: "b", initiative: 8 }]]]);
  assert.deepEqual([res.aInit, res.bInit], [8, 19]);
  assert.equal(await swapInitiative({ started: true, updateEmbeddedDocuments: async () => {} }, a, b), null);
  assert.equal(await swapInitiative(combat, a, mkCombatant({ id: "u", initiative: null })), null);
});

test("pickResponsibleUser prefers active non-GM owners (lowest id), else active GM", () => {
  const actor = { testUserPermission: (u) => u.owner };
  const u1 = { id: "u1", active: true, isGM: false, owner: true };
  const u2 = { id: "u2", active: true, isGM: false, owner: true };
  const gm = { id: "g", active: true, isGM: true, owner: true };
  assert.equal(pickResponsibleUser(actor, { users: [u2, u1, gm], activeGM: gm }).id, "u1");
  const offline = { id: "u3", active: false, isGM: false, owner: true };
  assert.equal(pickResponsibleUser(actor, { users: [offline, gm], activeGM: gm }).id, "g");
});
