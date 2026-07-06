// @ts-check
import { MODULE_ID, getSwapCandidates, isWindowOpen, swapInitiative } from "./swap.js";

const L = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data ?? {});

/** Resolve the actor's combatant in the active combat. */
export function getOwnerCombatant(actor, combat = game.combat) {
  if (!combat || !actor) return null;
  return combat.combatants.find((c) => c.actor?.id === actor.id) ?? null;
}

/**
 * Ask the owner to pick an ally via a sorted table with radios. No default selection —
 * confirming without a choice warns and keeps the dialog open. Returns the chosen
 * Combatant or null.
 * @param {Combatant[]} candidates
 * @param {string} ownerName  Alert owner's token/character name, for the dialog title.
 */
export async function promptAllySelection(candidates, ownerName) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sorted = [...candidates].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
  const rows = sorted.map((c) => `
    <tr class="ais-row">
      <td class="ais-radio"><input type="radio" name="ally" value="${c.id}"></td>
      <td class="ais-name">${esc(c.token?.name ?? c.name)}</td>
      <td class="ais-init">${Math.floor(c.initiative)}</td>
    </tr>`).join("");
  const content = `
    <style>
      .ais-scroll { max-height: 320px; overflow-y: auto; margin-top: 6px; }
      .ais-table { width: 100%; border-collapse: collapse; }
      .ais-table th { text-align: left; padding: 3px 8px; border-bottom: 2px solid var(--color-border-dark, #7a7971); }
      .ais-table td { padding: 4px 8px; border-bottom: 1px solid var(--color-border-light-tertiary, #c9c7ba); }
      .ais-row { cursor: pointer; }
      .ais-row:hover { background: rgba(0,0,0,0.06); }
      .ais-radio { width: 1.5em; text-align: center; }
      .ais-table th.ais-init, td.ais-init { text-align: right; font-weight: bold; font-variant-numeric: tabular-nums; }
    </style>
    <p>${L("dialog.pickBody")}</p>
    <div class="ais-scroll">
      <table class="ais-table">
        <thead><tr><th class="ais-radio"></th><th>${L("dialog.colName")}</th><th class="ais-init">${L("dialog.colInit")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  const getSel = (dialog) => dialog.element.querySelector('input[name="ally"]:checked')?.value ?? null;
  const choice = await DialogV2.wait({
    window: { title: L("dialog.pickTitle", { name: ownerName ?? "" }) },
    content,
    buttons: [
      { action: "swap", label: L("dialog.swap"), icon: "fa-solid fa-right-left",
        callback: (event, button, dialog) => getSel(dialog) },
      { action: "cancel", label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark", callback: () => null },
    ],
    render: (event, dialog) => {
      const root = dialog.element;
      // Whole-row click selects that row's radio.
      root.querySelectorAll("tr.ais-row").forEach((tr) => tr.addEventListener("click", () => {
        const r = tr.querySelector('input[type="radio"]');
        if (r) r.checked = true;
      }));
      // Validate on Swap: no selection → warn + keep the dialog open (capture phase blocks the submit).
      root.querySelector('button[data-action="swap"]')?.addEventListener("click", (ev) => {
        if (!root.querySelector('input[name="ally"]:checked')) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          ui.notifications.warn(L("notify.pickAlly"));
        }
      }, { capture: true });
    },
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
  const chosen = await promptAllySelection(candidates, owner.token?.name ?? actor.name);
  if (!chosen) return;
  await executeSwap(combat, owner, chosen);
}
