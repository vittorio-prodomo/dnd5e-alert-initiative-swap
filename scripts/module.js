// @ts-check
import { MODULE_ID, SETTINGS } from "./swap.js";
import { registerSwapQuery } from "./query.js";
import { registerVaeButton } from "./vaeButton.js";
import { registerInitiativePrompt } from "./initiativePrompt.js";

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.AUTO_PROMPT, {
    name: `${MODULE_ID}.settings.autoPrompt.name`,
    hint: `${MODULE_ID}.settings.autoPrompt.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

Hooks.once("init", () => {
  registerSettings();
  registerSwapQuery();
});

Hooks.once("ready", () => {
  registerInitiativePrompt();
  if (game.modules.get("visual-active-effects")?.active) registerVaeButton();
  console.log(`${MODULE_ID} | ready (autoPrompt=${game.settings.get(MODULE_ID, SETTINGS.AUTO_PROMPT)})`);
});
