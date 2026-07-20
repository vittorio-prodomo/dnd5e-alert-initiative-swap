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

/**
 * A CPR-summoned creature (the Beast Master's Beast of the Land, Flaming Sphere, Mage Hand, …). These are
 * not valid Alert initiative-swap targets — you swap with a willing party member, not your own summon (and
 * the companion beast is initiative-locked right behind its hunter anyway, so a swap is meaningless). Detected
 * structurally via the chris-premades summon flag, so there is no hard CPR dependency.
 */
export function isSummonedCreature(actor) {
  return !!actor?.flags?.["chris-premades"]?.summons?.control?.actor;
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
    if (isSummonedCreature(c.actor)) continue; // never offer a summon (e.g. the companion beast) as a swap target
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

/**
 * Every (actor, combatant) pair in the combat that THIS client should prompt for.
 * Pure — all environment injected. Called on any initiative change (the
 * `updateCombatant` hook), so it catches every roll path (individual, "Roll All",
 * "Roll NPC", Epic Rolls' `combatant.update({initiative})`, manual entry) and is
 * order-independent: a target surfaces as soon as an Alert holder AND an eligible
 * ally are both rolled, regardless of which one rolled last.
 * @param {object} p
 * @param {any} p.combat           The Combat.
 * @param {string} p.currentUserId game.user.id
 * @param {any[]} p.users          game.users.contents
 * @param {any} p.activeGM         game.users.activeGM
 * @param {(combatId: string, combatantId: string) => boolean} p.isPrompted one-shot check
 * @returns {{actor: any, combatant: any}[]}
 */
export function collectPromptTargets({ combat, currentUserId, users, activeGM, isPrompted }) {
  if (!combat || combat.started) return [];
  const out = [];
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || !hasAlert(actor) || !actor.hasPlayerOwner) continue;
    if (!isWindowOpen(combat, combatant)) continue;
    if (!getSwapCandidates(combat, combatant).length) continue;
    const prompter = pickResponsibleUser(actor, { users, activeGM });
    if (!prompter || currentUserId !== prompter.id) continue;
    if (isPrompted(combat.id, combatant.id)) continue;
    out.push({ actor, combatant });
  }
  return out;
}
