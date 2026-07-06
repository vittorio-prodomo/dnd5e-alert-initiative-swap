// @ts-check
import { MODULE_ID, SETTINGS, collectPromptTargets } from "./swap.js";
import { promptSwapYesNo, runSwapFlow } from "./flow.js";

const promptedThisSession = new Set();
const pendingCombatIds = new Set();
let activeAnimations = 0;
let pendingSince = 0;
let flushTimer = null;

// Wait for the 3D dice to settle before prompting. The debounce also coalesces a
// "Roll All" batch into one pass; the animation counter holds the prompt back while
// Dice So Nice is still animating; MAX_WAIT guards against a leaked counter (or DSN off).
const SETTLE_MS = 500;
const MAX_WAIT_MS = 8000;

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, SETTLE_MS);
}

async function flush() {
  flushTimer = null;
  if (activeAnimations > 0 && Date.now() - pendingSince < MAX_WAIT_MS) {
    scheduleFlush(); // dice still rolling — wait
    return;
  }
  const combatIds = [...pendingCombatIds];
  pendingCombatIds.clear();
  pendingSince = 0;
  for (const cid of combatIds) {
    const combat = game.combats.get(cid);
    if (!combat) continue;
    const targets = collectPromptTargets({
      combat,
      currentUserId: game.user.id,
      users: game.users.contents,
      activeGM: game.users.activeGM,
      isPrompted: (id, cbid) => promptedThisSession.has(`${id}:${cbid}`),
    });
    if (!targets.length) continue;
    // Reserve synchronously so a concurrent update can't double-prompt.
    for (const { combatant: c } of targets) promptedThisSession.add(`${cid}:${c.id}`);
    for (const { actor } of targets) {
      if (await promptSwapYesNo()) await runSwapFlow(actor, { combat });
    }
  }
}

/**
 * Fires on ANY combatant update. Keying off `initiative` being set catches every roll
 * path — individual rolls, dnd5e "Roll All"/"Roll NPC", Epic Rolls'
 * `combatant.update({initiative})`, and manual entry. We defer the actual prompt to
 * `flush`, which waits for the dice to settle.
 */
function onUpdateCombatant(combatant, changes) {
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)) return;
  if (changes?.initiative === null || changes?.initiative === undefined) return;
  const combat = combatant.parent;
  if (!combat) return;
  pendingCombatIds.add(combat.id);
  if (!pendingSince) pendingSince = Date.now();
  scheduleFlush();
}

export function registerInitiativePrompt() {
  Hooks.on("updateCombatant", onUpdateCombatant);
  // Hold the prompt until Dice So Nice finishes animating (if present/active).
  Hooks.on("diceSoNiceRollStart", () => { activeAnimations++; });
  Hooks.on("diceSoNiceRollComplete", () => {
    activeAnimations = Math.max(0, activeAnimations - 1);
    if (pendingCombatIds.size) scheduleFlush();
  });
}
