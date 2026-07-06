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
