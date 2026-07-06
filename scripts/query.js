// @ts-check
import { MODULE_ID, getSwapCandidates, isWindowOpen, swapInitiative } from "./swap.js";
import { postSwapChat } from "./flow.js";

/**
 * GM-side handler. Re-validates the swap is legal (same-disposition allies, both
 * rolled, window open) before performing it — the caller is untrusted (any user
 * can invoke a CONFIG.queries handler, with no requester identity).
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
