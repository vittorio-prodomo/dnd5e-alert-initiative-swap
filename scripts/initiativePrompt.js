// @ts-check
import { MODULE_ID, SETTINGS, collectPromptTargets } from "./swap.js";
import { promptSwapYesNo, runSwapFlow } from "./flow.js";

const promptedThisSession = new Set();

/**
 * Fires on ANY combatant update. Keying off `initiative` being set catches every
 * roll path — individual rolls, dnd5e "Roll All"/"Roll NPC" (which bypass the
 * per-actor `dnd5e.rollInitiative` hook), Epic Rolls' `combatant.update({initiative})`,
 * and manual entry. We re-scan the whole combat each time, so it's order-independent:
 * the prompt fires as soon as an Alert holder and an eligible ally are both rolled.
 */
async function onUpdateCombatant(combatant, changes) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)) return;
  if (changes?.initiative === null || changes?.initiative === undefined) return;
  const combat = combatant.parent;
  const targets = collectPromptTargets({
    combat,
    currentUserId: game.user.id,
    users: game.users.contents,
    activeGM: game.users.activeGM,
    isPrompted: (cid, cbid) => promptedThisSession.has(`${cid}:${cbid}`),
  });
  if (!targets.length) return;
  // Reserve every target synchronously first, so a concurrent update (e.g. the
  // "Roll All" batch firing updateCombatant N times) can't double-prompt.
  for (const { combatant: c } of targets) promptedThisSession.add(`${combat.id}:${c.id}`);
  for (const { actor } of targets) {
    if (await promptSwapYesNo()) await runSwapFlow(actor, { combat });
  }
}

export function registerInitiativePrompt() {
  Hooks.on("updateCombatant", onUpdateCombatant);
}
