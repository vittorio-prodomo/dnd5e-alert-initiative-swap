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
