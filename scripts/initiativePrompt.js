// @ts-check
import { MODULE_ID, SETTINGS, pickPromptCombatant } from "./swap.js";
import { promptSwapYesNo, runSwapFlow } from "./flow.js";

const promptedThisSession = new Set();

/**
 * dnd5e fires `dnd5e.rollInitiative` as **(actor, combatants)** — arg 1 is the ACTOR
 * that rolled, NOT the combat (dnd5e.mjs, Actor5e#rollInitiative). Derive the combat
 * from the combatant's parent.
 */
async function onRollInitiative(actor, combatants) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)) return;
  const combat = combatants?.[0]?.parent ?? game.combat;
  const target = pickPromptCombatant({
    actor, combatants, combat,
    currentUserId: game.user.id,
    users: game.users.contents,
    activeGM: game.users.activeGM,
    isPrompted: (cid, cbid) => promptedThisSession.has(`${cid}:${cbid}`),
  });
  if (!target) return;
  promptedThisSession.add(`${combat.id}:${target.id}`);
  if (await promptSwapYesNo()) await runSwapFlow(actor, { combat });
}

export function registerInitiativePrompt() {
  Hooks.on("dnd5e.rollInitiative", onRollInitiative);
}
