// @ts-check
import { MODULE_ID, getSwapCandidates, isWindowOpen, swapInitiative } from "./swap.js";

const L = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data ?? {});

/** Resolve the actor's combatant in the active combat. */
export function getOwnerCombatant(actor, combat = game.combat) {
  if (!combat || !actor) return null;
  return combat.combatants.find((c) => c.actor?.id === actor.id) ?? null;
}

/** Ask the owner to pick an ally via a radio list. Returns the chosen Combatant or null. */
export async function promptAllySelection(candidates) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const rows = candidates.map((c, i) => `
    <label class="ais-row">
      <input type="radio" name="ally" value="${c.id}"${i === 0 ? " checked" : ""}>
      <span class="ais-name">${esc(c.token?.name ?? c.name)}</span>
      <span class="ais-init">${Math.floor(c.initiative)}</span>
    </label>`).join("");
  const content = `
    <style>
      .ais-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; margin-top: 6px; }
      .ais-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 1px solid var(--color-border-light-tertiary, #b5b3a4); border-radius: 4px; cursor: pointer; }
      .ais-row:hover { background: rgba(0,0,0,0.06); }
      .ais-name { flex: 1 1 auto; }
      .ais-init { flex: 0 0 auto; min-width: 1.5em; text-align: center; font-weight: bold; padding: 1px 9px; border-radius: 10px; background: rgba(0,0,0,0.1); }
    </style>
    <p>${L("dialog.pickBody")}</p>
    <div class="ais-list">${rows}</div>`;
  const selected = (button, dialog) => {
    const root = dialog?.element ?? button?.form ?? button?.closest?.("form");
    return root?.querySelector?.('input[name="ally"]:checked')?.value ?? null;
  };
  const choice = await DialogV2.wait({
    window: { title: L("dialog.pickTitle") },
    content,
    buttons: [
      { action: "swap", label: L("dialog.swap"), icon: "fa-solid fa-right-left", default: true,
        callback: (event, button, dialog) => selected(button, dialog) },
      { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark",
        callback: () => null },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!choice) return null;
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
