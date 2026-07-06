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
