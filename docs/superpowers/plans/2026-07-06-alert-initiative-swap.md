# Alert Initiative Swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `dnd5e-alert-initiative-swap`, an owned FoundryVTT v13 world module that surfaces the 2024 Alert feat's initiative swap as a Visual Active Effects tooltip button and an optional post-roll prompt.

**Architecture:** A small ESM world module. Pure, node-tested logic (`swap.js`) is isolated from Foundry globals. An interactive layer (`flow.js`) drives the ally-picker/confirm dialogs and the public chat line. Because a player cannot mutate an ally's Combatant, the actual initiative write is routed to the GM's client via v13's native `CONFIG.queries` + `User#query`, with a self-validating handler (`query.js`). Two thin hook adapters (`vaeButton.js`, `initiativePrompt.js`) are the entry points; `module.js` registers settings and wires everything.

**Tech Stack:** JavaScript ESM + `// @ts-check`, no build step. Node's built-in test runner (`node --test`) for the pure core. FoundryVTT v13 / dnd5e 5.x. Visual Active Effects (recommended, not required).

## Global Constraints

- **Target FoundryVTT v13 API forms** (NOT v14): ActiveEffect uses top-level `changes` with numeric `mode`; DialogV2 is `foundry.applications.api.DialogV2`.
- `MODULE_ID = "dnd5e-alert-initiative-swap"` — used verbatim as settings namespace, i18n key prefix, flag scope, and query prefix.
- Plain JS ESM, every script file starts with `// @ts-check`. **No build/bundle step.**
- Tests: `node --test test/swap.test.js` (explicit file path — node 25 has a `--test <dir>` discovery quirk; pass the file, not the directory). `package.json` has `"type": "module"`.
- **Ally rule:** same token `disposition` as the Alert owner; candidate must have already rolled (`initiative !== null`) and not be Incapacitated; the owner must not be Incapacitated.
- **Window:** `game.combat` exists AND `!combat.started` AND owner has rolled.
- Auto-prompt world setting `autoPrompt` default **true**. Chat confirmation is **public**.
- i18n **en + it** (all player-facing strings). The IT feat term ("Allerta") is a best-guess — confirm against the world's Babele/dnd5e-it locale during live-verify; detection keys off the locale-independent `system.identifier === "alert"`, so a wrong display term never breaks logic.
- **No hard dependencies.** VAE is `relationships.recommends`; the button hook only registers when VAE is active.
- GM-side swap handler is remotely invocable by any user with no requester identity (v13 `CONFIG.queries` behavior) → it MUST re-validate swap legality before mutating. Trust model: home game.

---

### Task 1: Scaffold module, manifest, git repo, symlink

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/module.json`
- Create: `modules/dnd5e-alert-initiative-swap/package.json`
- Create: `modules/dnd5e-alert-initiative-swap/.gitignore`
- Create: `modules/dnd5e-alert-initiative-swap/scripts/module.js` (init stub; fleshed out in Task 7)

**Interfaces:**
- Produces: the loadable module skeleton + `MODULE_ID` console marker.

- [ ] **Step 1: Create `module.json`**

```json
{
  "id": "dnd5e-alert-initiative-swap",
  "title": "Alert Initiative Swap (2024)",
  "description": "Surfaces the 2024 Alert feat's initiative swap as a Visual Active Effects button and an optional post-roll prompt.",
  "version": "0.1.0",
  "authors": [{ "name": "Vittorio" }],
  "compatibility": { "minimum": "13", "verified": "13" },
  "relationships": {
    "systems": [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5" } }],
    "recommends": [{ "id": "visual-active-effects", "type": "module" }]
  },
  "esmodules": ["scripts/module.js"],
  "languages": [
    { "lang": "en", "name": "English", "path": "lang/en.json" },
    { "lang": "it", "name": "Italiano", "path": "lang/it.json" }
  ]
}
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "dnd5e-alert-initiative-swap",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/swap.test.js" }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Create `scripts/module.js` stub**

```js
// @ts-check
export const MODULE_ID = "dnd5e-alert-initiative-swap";
Hooks.once("ready", () => console.log(`${MODULE_ID} | loaded`));
```

- [ ] **Step 5: Init git + first commit**

Run:
```bash
cd modules/dnd5e-alert-initiative-swap
git init -q && git add -A && git commit -q -m "chore: scaffold dnd5e-alert-initiative-swap module

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

- [ ] **Step 6: Symlink into the v13 data dir + validate manifest**

Run:
```bash
ln -sfn "$PWD" /home/vittorio/foundrydata-v13/Data/modules/dnd5e-alert-initiative-swap
node -e "JSON.parse(require('fs').readFileSync('module.json','utf8')); console.log('manifest OK')"
ls -l /home/vittorio/foundrydata-v13/Data/modules/dnd5e-alert-initiative-swap
```
Expected: `manifest OK` and the symlink resolves to the repo.

---

### Task 2: `swap.js` — pure core with node tests (TDD)

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/scripts/swap.js`
- Test: `modules/dnd5e-alert-initiative-swap/test/swap.test.js`

**Interfaces:**
- Produces (consumed by every later task):
  - `MODULE_ID: string`, `SETTINGS: {AUTO_PROMPT: "autoPrompt"}`
  - `getAlertFeat(actor) → Item|null`
  - `hasAlert(actor) → boolean`
  - `isIncapacitated(actor) → boolean`
  - `isWindowOpen(combat, ownerCombatant) → boolean`
  - `getSwapCandidates(combat, ownerCombatant) → Combatant[]`
  - `swapInitiative(combat, a, b) → Promise<{a,b,aInit,bInit}|null>`
  - `pickResponsibleUser(actor, {users, activeGM}) → User|null`

- [ ] **Step 1: Write the failing tests**

Create `test/swap.test.js`:
```js
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
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd modules/dnd5e-alert-initiative-swap && node --test test/swap.test.js`
Expected: FAIL — `Cannot find module '../scripts/swap.js'` / import errors.

- [ ] **Step 3: Implement `scripts/swap.js`**

```js
// @ts-check
/** Pure, Foundry-global-free helpers for the Alert initiative swap. */

export const MODULE_ID = "dnd5e-alert-initiative-swap";
export const SETTINGS = { AUTO_PROMPT: "autoPrompt" };

/** @returns {any|null} the Alert feat item on an actor, or null */
export function getAlertFeat(actor) {
  if (!actor?.items) return null;
  return actor.items.find(
    (i) => i.type === "feat" && (i.system?.identifier === "alert" || i.name === "Alert")
  ) ?? null;
}

export function hasAlert(actor) {
  return !!getAlertFeat(actor);
}

export function isIncapacitated(actor) {
  return !!actor?.statuses?.has?.("incapacitated");
}

/** Is the pre-combat swap window open for this owner combatant? */
export function isWindowOpen(combat, ownerCombatant) {
  if (!combat || combat.started) return false;
  const init = ownerCombatant?.initiative;
  if (init === null || init === undefined) return false;
  const actor = ownerCombatant.actor;
  if (!actor || isIncapacitated(actor)) return false;
  return true;
}

/** Same-disposition allies who have rolled and aren't incapacitated (excludes the owner). */
export function getSwapCandidates(combat, ownerCombatant) {
  if (!combat || !ownerCombatant) return [];
  const ownerDisp = ownerCombatant.token?.disposition;
  const out = [];
  for (const c of combat.combatants) {
    if (c.id === ownerCombatant.id) continue;
    if (c.initiative === null || c.initiative === undefined) continue;
    if (c.token?.disposition !== ownerDisp) continue;
    if (!c.actor || isIncapacitated(c.actor)) continue;
    out.push(c);
  }
  return out;
}

/** Atomically exchange the initiative of two combatants. Guards started/unrolled. */
export async function swapInitiative(combat, a, b) {
  if (!combat || combat.started || !a || !b) return null;
  const aInit = a.initiative;
  const bInit = b.initiative;
  if (aInit === null || aInit === undefined || bInit === null || bInit === undefined) return null;
  await combat.updateEmbeddedDocuments("Combatant", [
    { _id: a.id, initiative: bInit },
    { _id: b.id, initiative: aInit },
  ]);
  return { a, b, aInit, bInit };
}

/** Deterministic single prompter: active non-GM owner (lowest id), else active GM. */
export function pickResponsibleUser(actor, { users, activeGM }) {
  const owners = users
    .filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))
    .sort((x, y) => x.id.localeCompare(y.id));
  return owners[0] ?? activeGM ?? null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `node --test test/swap.test.js`
Expected: PASS — 6 tests, 0 failures. (Use node 25 via nvm: `nvm use 25` if needed.)

- [ ] **Step 5: Commit**

```bash
git add scripts/swap.js test/swap.test.js
git commit -q -m "feat: pure Alert-swap core (candidates, swap, responsible-user) + node tests

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 3: `flow.js` — interactive swap flow (dialogs, chat, GM routing)

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/scripts/flow.js`

**Interfaces:**
- Consumes: `swap.js` (`MODULE_ID`, `getSwapCandidates`, `isWindowOpen`, `swapInitiative`).
- Produces: `getOwnerCombatant(actor, combat?) → Combatant|null`; `promptSwapYesNo() → Promise<boolean>`; `runSwapFlow(actor, {combat?}) → Promise<void>`; `postSwapChat({a,b,aInit,bInit}) → Promise<void>`.

- [ ] **Step 1: Implement `scripts/flow.js`**

```js
// @ts-check
import { MODULE_ID, getSwapCandidates, isWindowOpen, swapInitiative } from "./swap.js";

const L = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data ?? {});

/** Resolve the actor's combatant in the active combat. */
export function getOwnerCombatant(actor, combat = game.combat) {
  if (!combat || !actor) return null;
  return combat.combatants.find((c) => c.actor?.id === actor.id) ?? null;
}

/** Ask the owner to pick an ally. Returns the chosen Combatant or null. */
export async function promptAllySelection(candidates) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const buttons = candidates.map((c) => ({
    action: c.id,
    label: L("dialog.candidate", { name: c.token?.name ?? c.name, init: c.initiative }),
    callback: () => c.id,
  }));
  buttons.push({ action: "cancel", label: game.i18n.localize("Cancel"), default: true, callback: () => null });
  const choice = await DialogV2.wait({
    window: { title: L("dialog.pickTitle") },
    content: `<p>${L("dialog.pickBody")}</p>`,
    buttons,
    rejectClose: false,
  }).catch(() => null);
  if (!choice || choice === "cancel") return null;
  return candidates.find((c) => c.id === choice) ?? null;
}

/** Yes/No prompt after rolling initiative. */
export async function promptSwapYesNo() {
  const DialogV2 = foundry.applications.api.DialogV2;
  return !!(await DialogV2.confirm({
    window: { title: L("prompt.title") },
    content: `<p>${L("prompt.body")}</p>`,
    rejectClose: false,
  }).catch(() => false));
}

/** Post the public swap confirmation line. */
export async function postSwapChat({ a, b, aInit, bInit }) {
  await ChatMessage.create({
    content: L("chat.swapped", {
      a: a.token?.name ?? a.name, b: b.token?.name ?? b.name, aInit, bInit,
    }),
  });
}

/**
 * Perform the swap. Combatant mutation requires the GM (a player cannot update
 * an ally's Combatant), so route via the GM's client unless we already are the GM.
 */
async function executeSwap(combat, owner, ally) {
  if (game.user.isGM) {
    const res = await swapInitiative(combat, owner, ally);
    if (res) await postSwapChat(res);
    return;
  }
  const gm = game.users.activeGM;
  if (!gm) { ui.notifications.warn(L("notify.noGM")); return; }
  await gm.query(`${MODULE_ID}.swap`, { combatId: combat.id, aId: owner.id, bId: ally.id });
}

/** The single interactive flow both entry points call. */
export async function runSwapFlow(actor, { combat = game.combat } = {}) {
  const owner = getOwnerCombatant(actor, combat);
  if (!isWindowOpen(combat, owner)) { ui.notifications.info(L("notify.windowClosed")); return; }
  const candidates = getSwapCandidates(combat, owner);
  if (!candidates.length) { ui.notifications.info(L("notify.noAllies")); return; }
  const chosen = await promptAllySelection(candidates);
  if (!chosen) return;
  await executeSwap(combat, owner, chosen);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/flow.js`
Expected: no output (exit 0). (Full behavior is live-verified in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add scripts/flow.js
git commit -q -m "feat: interactive swap flow — ally picker, yes/no, public chat, GM routing

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 4: `query.js` — GM-side self-validating swap handler

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/scripts/query.js`

**Interfaces:**
- Consumes: `swap.js` (`MODULE_ID`, `getSwapCandidates`, `isWindowOpen`, `swapInitiative`); `flow.js` (`postSwapChat`).
- Produces: `registerSwapQuery() → void` (registers `CONFIG.queries["<id>.swap"]`).

**Rationale:** `CONFIG.queries` handlers are invocable by any user with no requester identity (verified in the bridge's `queries.ts` security note), so the handler re-validates legality (window + candidate membership) before mutating — it never trusts the caller.

- [ ] **Step 1: Implement `scripts/query.js`**

```js
// @ts-check
import { MODULE_ID, getSwapCandidates, isWindowOpen, swapInitiative } from "./swap.js";
import { postSwapChat } from "./flow.js";

/**
 * GM-side handler. Re-validates the swap is legal (same-disposition allies, both
 * rolled, window open) before performing it — the caller is untrusted.
 * @param {{combatId: string, aId: string, bId: string}} data
 */
async function handleSwap({ combatId, aId, bId }) {
  const combat = game.combats.get(combatId);
  if (!combat) return { ok: false, reason: "no-combat" };
  const a = combat.combatants.get(aId);
  const b = combat.combatants.get(bId);
  if (!a || !b) return { ok: false, reason: "no-combatant" };
  if (!isWindowOpen(combat, a)) return { ok: false, reason: "window-closed" };
  if (!getSwapCandidates(combat, a).some((c) => c.id === b.id)) return { ok: false, reason: "illegal-target" };
  const res = await swapInitiative(combat, a, b);
  if (!res) return { ok: false, reason: "swap-failed" };
  await postSwapChat(res);
  return { ok: true, aInit: res.aInit, bInit: res.bInit };
}

export function registerSwapQuery() {
  CONFIG.queries ??= {};
  CONFIG.queries[`${MODULE_ID}.swap`] = handleSwap;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/query.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/query.js
git commit -q -m "feat: GM-side self-validating swap query handler (CONFIG.queries)

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 5: `vaeButton.js` — Visual Active Effects tooltip button

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/scripts/vaeButton.js`

**Interfaces:**
- Consumes: `swap.js` (`MODULE_ID`, `getAlertFeat`, `getSwapCandidates`, `isWindowOpen`); `flow.js` (`getOwnerCombatant`, `runSwapFlow`).
- Produces: `registerVaeButton() → void`.

**Note on "only appears":** the handler evaluates the window at button-build time, so the button is present only in-window. VAE re-renders its panel on combat/duration changes, which typically covers appear/disappear; if live-verify shows a lag, add a nudge (Task 8, optional step) — never incorrect regardless, since `runSwapFlow` re-checks.

- [ ] **Step 1: Implement `scripts/vaeButton.js`**

```js
// @ts-check
import { MODULE_ID, getAlertFeat, getSwapCandidates, isWindowOpen } from "./swap.js";
import { getOwnerCombatant, runSwapFlow } from "./flow.js";

function resolveActor(effect) {
  let actor = effect?.parent;
  if (actor && actor.documentName !== "Actor") actor = actor.actor;
  return actor ?? null;
}

function effectBelongsToItem(effect, item) {
  if (typeof effect?.origin === "string" && effect.origin.includes(item.id)) return true;
  return effect?.name === item.name;
}

/** VAE hook: push a "Swap Initiative" button onto an in-window Alert effect. */
function onCreateEffectButtons(effect, buttons) {
  const actor = resolveActor(effect);
  if (!actor) return;
  const feat = getAlertFeat(actor);
  if (!feat || !effectBelongsToItem(effect, feat)) return;
  const combat = game.combat;
  const owner = getOwnerCombatant(actor, combat);
  if (!isWindowOpen(combat, owner)) return;
  if (!getSwapCandidates(combat, owner).length) return;
  buttons.push({
    label: game.i18n.localize(`${MODULE_ID}.button.swap`),
    callback: () => runSwapFlow(actor, { combat }),
  });
}

export function registerVaeButton() {
  Hooks.on("visual-active-effects.createEffectButtons", onCreateEffectButtons);
}
```

- [ ] **Step 2: Syntax check** — Run: `node --check scripts/vaeButton.js` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/vaeButton.js
git commit -q -m "feat: VAE tooltip 'Swap Initiative' button on in-window Alert effects

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 6: `initiativePrompt.js` — optional post-roll auto-prompt

**Files:**
- Create: `modules/dnd5e-alert-initiative-swap/scripts/initiativePrompt.js`

**Interfaces:**
- Consumes: `swap.js` (`MODULE_ID`, `SETTINGS`, `hasAlert`, `getSwapCandidates`, `isWindowOpen`, `pickResponsibleUser`); `flow.js` (`promptSwapYesNo`, `runSwapFlow`).
- Produces: `registerInitiativePrompt() → void`.

**One-shot guard:** an in-memory `Set` keyed `combatId:combatantId` (only the single responsible client prompts, so local state suffices; a reload resetting it — at most one extra prompt — is acceptable and avoids any Combatant write-permission issue).

- [ ] **Step 1: Implement `scripts/initiativePrompt.js`**

```js
// @ts-check
import {
  MODULE_ID, SETTINGS, hasAlert, getSwapCandidates, isWindowOpen, pickResponsibleUser,
} from "./swap.js";
import { promptSwapYesNo, runSwapFlow } from "./flow.js";

const promptedThisSession = new Set();

/** dnd5e fires this right after initiative is set (combat not yet started). */
async function onRollInitiative(combat, combatants) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)) return;
  if (!combat || combat.started) return;
  for (const combatant of combatants) {
    const actor = combatant.actor;
    if (!actor || !hasAlert(actor) || !actor.hasPlayerOwner) continue;
    if (!isWindowOpen(combat, combatant)) continue;
    if (!getSwapCandidates(combat, combatant).length) continue;
    const prompter = pickResponsibleUser(actor, {
      users: game.users.contents, activeGM: game.users.activeGM,
    });
    if (!prompter || game.user.id !== prompter.id) continue;
    const key = `${combat.id}:${combatant.id}`;
    if (promptedThisSession.has(key)) continue;
    promptedThisSession.add(key);
    if (await promptSwapYesNo()) await runSwapFlow(actor, { combat });
  }
}

export function registerInitiativePrompt() {
  Hooks.on("dnd5e.rollInitiative", onRollInitiative);
}
```

- [ ] **Step 2: Syntax check** — Run: `node --check scripts/initiativePrompt.js` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/initiativePrompt.js
git commit -q -m "feat: optional post-roll auto-prompt for player-owned Alert holders

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 7: `module.js` wiring + settings + i18n

**Files:**
- Modify: `modules/dnd5e-alert-initiative-swap/scripts/module.js` (replace the Task-1 stub)
- Create: `modules/dnd5e-alert-initiative-swap/lang/en.json`
- Create: `modules/dnd5e-alert-initiative-swap/lang/it.json`

**Interfaces:**
- Consumes: `swap.js` (`MODULE_ID`, `SETTINGS`); `query.js` (`registerSwapQuery`); `vaeButton.js` (`registerVaeButton`); `initiativePrompt.js` (`registerInitiativePrompt`).

- [ ] **Step 1: Replace `scripts/module.js`**

```js
// @ts-check
import { MODULE_ID, SETTINGS } from "./swap.js";
import { registerSwapQuery } from "./query.js";
import { registerVaeButton } from "./vaeButton.js";
import { registerInitiativePrompt } from "./initiativePrompt.js";

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.AUTO_PROMPT, {
    name: `${MODULE_ID}.settings.autoPrompt.name`,
    hint: `${MODULE_ID}.settings.autoPrompt.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerSwapQuery();
});

Hooks.once("ready", () => {
  registerInitiativePrompt();
  if (game.modules.get("visual-active-effects")?.active) registerVaeButton();
  console.log(`${MODULE_ID} | ready (autoPrompt=${game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)})`);
});
```

- [ ] **Step 2: Create `lang/en.json`**

```json
{
  "dnd5e-alert-initiative-swap.button.swap": "Swap Initiative (Alert)",
  "dnd5e-alert-initiative-swap.dialog.pickTitle": "Alert — Swap Initiative",
  "dnd5e-alert-initiative-swap.dialog.pickBody": "Choose a willing ally to swap initiative with:",
  "dnd5e-alert-initiative-swap.dialog.candidate": "{name} — initiative {init}",
  "dnd5e-alert-initiative-swap.prompt.title": "Alert Feat",
  "dnd5e-alert-initiative-swap.prompt.body": "You have the Alert feat! You can swap your initiative with a willing ally. Swap now?",
  "dnd5e-alert-initiative-swap.chat.swapped": "<strong>Alert</strong> — {a} ⇄ {b}: initiative {aInit} ↔ {bInit}",
  "dnd5e-alert-initiative-swap.notify.windowClosed": "Alert: initiative can only be swapped after rolling, before combat starts.",
  "dnd5e-alert-initiative-swap.notify.noAllies": "Alert: no eligible allies to swap initiative with.",
  "dnd5e-alert-initiative-swap.notify.noGM": "Alert: a GM must be online to swap initiative.",
  "dnd5e-alert-initiative-swap.settings.autoPrompt.name": "Prompt Alert owners to swap initiative",
  "dnd5e-alert-initiative-swap.settings.autoPrompt.hint": "After a player-owned character with the Alert feat rolls initiative (before combat starts), ask whether to swap with a willing ally."
}
```

- [ ] **Step 3: Create `lang/it.json`** (IT feat term "Allerta" — confirm during live-verify)

```json
{
  "dnd5e-alert-initiative-swap.button.swap": "Scambia iniziativa (Allerta)",
  "dnd5e-alert-initiative-swap.dialog.pickTitle": "Allerta — Scambia iniziativa",
  "dnd5e-alert-initiative-swap.dialog.pickBody": "Scegli un alleato consenziente con cui scambiare l'iniziativa:",
  "dnd5e-alert-initiative-swap.dialog.candidate": "{name} — iniziativa {init}",
  "dnd5e-alert-initiative-swap.prompt.title": "Talento Allerta",
  "dnd5e-alert-initiative-swap.prompt.body": "Hai il talento Allerta! Puoi scambiare la tua iniziativa con un alleato consenziente. Scambiare ora?",
  "dnd5e-alert-initiative-swap.chat.swapped": "<strong>Allerta</strong> — {a} ⇄ {b}: iniziativa {aInit} ↔ {bInit}",
  "dnd5e-alert-initiative-swap.notify.windowClosed": "Allerta: l'iniziativa si può scambiare solo dopo averla tirata, prima che il combattimento inizi.",
  "dnd5e-alert-initiative-swap.notify.noAllies": "Allerta: nessun alleato idoneo con cui scambiare l'iniziativa.",
  "dnd5e-alert-initiative-swap.notify.noGM": "Allerta: un GM deve essere online per scambiare l'iniziativa.",
  "dnd5e-alert-initiative-swap.settings.autoPrompt.name": "Chiedi ai possessori di Allerta di scambiare l'iniziativa",
  "dnd5e-alert-initiative-swap.settings.autoPrompt.hint": "Dopo che un personaggio giocante con il talento Allerta tira l'iniziativa (prima che il combattimento inizi), chiedi se scambiarla con un alleato consenziente."
}
```

- [ ] **Step 4: Syntax + JSON validity check**

Run:
```bash
node --check scripts/module.js
node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); JSON.parse(require('fs').readFileSync('lang/it.json','utf8')); console.log('lang OK')"
node --test test/swap.test.js
```
Expected: `lang OK` and the 6 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/module.js lang/en.json lang/it.json
git commit -q -m "feat: wire hooks + settings + en/it i18n

Claude-Session: https://claude.ai/code/session_01Fe84MMvZJx41aQxSnQ3LE1"
```

---

### Task 8: Live verification in `dev-sandbox-v13`

**Files:** none (integration).

**Prereqs:** Foundry v13 running; the agent client can log in as the "Claude" GM; Warpey has an Alert feat with identifier `alert` (verify via `get-character-entity`; if his Alert is a plain DDB item lacking a VAE-rendered effect, note it — the button needs an effect to hang on; the CPR Alert premade's transfer effect provides one).

- [ ] **Step 1: Register the new module + enable it**

A brand-new manifest needs a Foundry rescan. Run:
```bash
systemctl --user restart foundryvtt-v13
```
Then enable `dnd5e-alert-initiative-swap` in `dev-sandbox-v13`'s Manage Modules, and re-login the agent client. Confirm the console shows `dnd5e-alert-initiative-swap | ready (autoPrompt=true)`.

- [ ] **Step 2: Verify the VAE button (in-window appearance + swap)**

Via the agent client: create a combat with Warpey + an ally (e.g. Xender) + an enemy; roll initiative for all; do **not** begin combat. Hover Warpey's Alert effect in the VAE panel → a **"Swap Initiative (Alert)"** button is present. Click it → ally picker lists only same-disposition rolled allies (Xender, not the enemy) → pick Xender → the two initiatives swap in the tracker and a public chat line posts. Then **Begin Combat** → re-hover → the button is **gone**.
- If the button doesn't disappear/appear promptly on state change, add a VAE-refresh nudge to `vaeButton.js` (`registerVaeButton`): on `dnd5e.rollInitiative` and `updateCombat` (started/round change), re-render VAE's panel app (locate its instance via `foundry.applications.instances` / `ui.windows`, matched against the installed VAE source). Commit as a follow-up.

- [ ] **Step 3: Verify the auto-prompt**

With `autoPrompt` on, roll Warpey's initiative afresh (new combat) → the Yes/No dialog appears (as sole GM it routes to the GM via fallback). **No** → dismiss, no change. **Yes** → ally picker → swap. Re-roll Warpey's initiative → confirm **no** second prompt (one-shot). Confirm a non-Alert PC (e.g. Nahuel) triggers **no** prompt. Toggle the setting off → roll → **no** prompt.

- [ ] **Step 4: Record the open player-routing check**

The prompter-selection routes to the owning **player** in real play; verifying a player (Giulio→Warpey) sees the prompt while the GM does not needs simultaneous GM + player logins (one agent browser profile can't do both — same limitation as the DSN nameplate check). Note it as the single deferred live-check; the GM-fallback path is proven here.

- [ ] **Step 5: Update memory**

Add a `reference_dnd5e_alert_initiative_swap.md` memory entry + MEMORY.md pointer; note the module in CLAUDE.md's owned-modules set. (Do not push to GitHub without Vittorio's go-ahead.)

---

## Self-Review

**1. Spec coverage:**
- §3 window/ally rules → `isWindowOpen`/`getSwapCandidates` (Task 2), enforced at every entry point + GM handler. ✓
- §4 swap core → Task 2. ✓
- §5 VAE button (in-window) → Task 5. ✓
- §6 auto-prompt (player-owned, single prompter, one-shot, setting) → Task 6. ✓
- §7 ally-picker → `promptAllySelection` (Task 3). ✓
- §8 setting (world, default true) → Task 7. ✓
- §9 i18n en+it → Task 7. ✓
- §10 manifest/recommends VAE/no hard deps → Task 1. ✓
- §12 edge cases → covered across guards + Task 8 checks. ✓
- §13 testing (node core + live) → Tasks 2 + 8. ✓
- **Added beyond spec (necessary):** GM-side execution via `CONFIG.queries` (Tasks 3/4) — a player can't mutate an ally's Combatant. Spec §6 described the prompter routing but not the mutation routing; this closes that gap. Public chat posts GM-side.

**2. Placeholder scan:** No TBD/TODO; every code step is complete. The only flagged uncertainty is the IT feat term and the optional VAE-refresh nudge — both have concrete resolution steps in Task 8, not placeholders.

**3. Type consistency:** `swapInitiative` returns `{a,b,aInit,bInit}`; `postSwapChat`/`query.js` consume exactly those keys. `pickResponsibleUser({users, activeGM})` called with `{users: game.users.contents, activeGM: game.users.activeGM}` (Task 6). `runSwapFlow(actor, {combat})` signature identical in Tasks 3/5/6. `registerSwapQuery`/`registerVaeButton`/`registerInitiativePrompt` names match their imports in Task 7. ✓
