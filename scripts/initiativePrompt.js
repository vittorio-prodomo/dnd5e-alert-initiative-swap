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
