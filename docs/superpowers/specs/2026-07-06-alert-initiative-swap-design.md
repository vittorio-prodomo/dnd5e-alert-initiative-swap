# Alert Initiative Swap — Design Spec

- **Date:** 2026-07-06
- **Module:** `dnd5e-alert-initiative-swap` — owned world module (FoundryVTT **v13**, dnd5e 5.x)
- **Status:** Design approved (brainstorming) → pending implementation plan

## 1. Purpose & context

The 2024 **Alert** feat lets its owner, immediately after rolling initiative, **swap their initiative with a willing ally** (unless either is Incapacitated). CPR's Alert premade already implements the swap — its macro fires when the Alert *activity* is used and exchanges the two combatants' initiative — but that path is only reachable by manually using the feat from the sheet/HUD, and beginner players routinely forget the feat exists.

This module **surfaces the swap two additional, discoverable ways, without touching the CPR fork**:

1. A **VAE tooltip button** ("Swap Initiative") on the Alert effect — analogous to CPR's Hunter's Mark "move" button.
2. An **optional auto-prompt** right after the owner rolls initiative — *"You have the Alert feat! Swap now?"* (Yes / No), in the spirit of a reaction prompt.

Both funnel into a single, self-contained swap flow. The module has **no hard dependency on CPR or MidiQoL**; it keys off the `alert` feat identifier, so it works whether the actor's Alert came from the CPR premade or a plain DDB import.

## 2. Goals / non-goals

**Goals**
- Discoverable, one-click initiative swap for Alert owners, valid only in the RAW window (after initiative rolled, before combat starts).
- Same-disposition "willing ally" model; exclude combatants who haven't rolled or are Incapacitated.
- Optional, GM-controlled auto-prompt to catch forgetful players, routed to the owning player's client.
- Self-contained, re-import-durable, **zero CPR / MidiQoL fork drift**.

**Non-goals**
- The Alert feat's `@prof`-to-initiative benefit — stays on whatever Alert item the actor already has; not this module's concern.
- Generalizing to other feats/abilities (Alert-only for v1).
- Adjudicating "willing" beyond disposition (GM trust assumed; same-disposition is the proxy).
- Cross-combat or mid-combat swaps (window is strictly pre-combat-start).

## 3. The RAW window & "willing ally" (the rules this encodes)

- **Window open** ⟺ `game.combat` exists **and** `!game.combat.started` **and** the owner's combatant has `initiative !== null`.
- **Candidate ally** ⟺ a *different* combatant in the same combat with: `initiative !== null` (already rolled), `token.disposition === owner.token.disposition` (same side — party PCs + friendly NPCs/companions), and **not Incapacitated**.
- **Owner guard:** the Alert owner must not be Incapacitated.
- "Incapacitated" = `actor.statuses.has("incapacitated")` (dnd5e adds this as a rider status for Paralyzed/Stunned/Unconscious/etc., so those are covered).

## 4. Swap core — `scripts/swap.js` (pure, node-testable)

- `getAlertFeat(actor)` → the Alert feat item, or `null` (match `system.identifier === "alert"`, name fallback `"Alert"`).
- `hasAlert(actor)` → boolean.
- `isIncapacitated(actor)` → boolean.
- `getSwapCandidates(combat, ownerCombatant)` → `Combatant[]` per §3.
- `swapInitiative(combat, a, b)` → single atomic `combat.updateEmbeddedDocuments("Combatant", [...])` exchanging the two `initiative` values; re-guards (both rolled, combat not started); returns the swapped pair + values for messaging. Tracker re-sorts itself.
- `runSwapFlow(alertActor, { combat })` → orchestrator shared by **both** entry points:
  1. resolve the owner's combatant,
  2. re-check the window,
  3. `getSwapCandidates()` → if empty, `ui.notifications.info(<no eligible allies>)` and stop,
  4. `promptAllySelection()` → chosen ally (or cancel),
  5. `swapInitiative()`,
  6. post a short **public** chat line (e.g. *"Alert — Warpey ⇄ Xender: initiative 8 ↔ 19"*) — visible to the whole table (initiative order is table-visible anyway).

`getSwapCandidates` and `swapInitiative` are pure given mock `combat`/`combatant`/`actor` objects → covered by node tests.

## 5. Entry point A — VAE tooltip button — `scripts/vaeButton.js`

- Register on `visual-active-effects.createEffectButtons(effect, buttons)` **only if VAE is active**.
- Resolve the effect's actor (`effect.parent`; if not an Actor, `.actor`) and whether the effect belongs to the Alert feat (resolve `effect.origin` → item with identifier `alert`; name fallback).
- If the **window is open** for that actor **and** `getSwapCandidates().length > 0`, push `{ label: i18n("Swap Initiative"), callback: () => runSwapFlow(actor, { combat }) }`.
- Effect: the button **only appears** inside the valid window (the preferred behavior). The callback re-checks as a backstop.
- On combat-state transitions (`dnd5e.rollInitiative`, and the `combat.started` flip via `updateCombat`), **nudge VAE to re-render** so the button appears/disappears promptly. If no clean VAE refresh is available, accept a possible one-render lag — the button is still correct on next panel render, and the callback guards regardless (graceful degrade to "present but no-ops with a toast").

## 6. Entry point B — auto-prompt — `scripts/prompt.js`

- Register on `dnd5e.rollInitiative(combat, combatants)` (fires right after initiative is set, combat not yet started).
- Gated by world setting `autoPrompt` (default **ON**).
- For each rolled combatant whose actor `hasAlert` **and** `actor.hasPlayerOwner`:
  - Skip if the owner is Incapacitated or there are no candidates.
  - **One-shot guard:** skip if the combatant carries `flags[MODULE_ID].prompted`; otherwise set it (a re-roll will not re-nag).
  - **Single responsible client:** compute the prompter = active non-GM owners of the actor, deterministic pick (lowest user id); fall back to `game.users.activeGM` if none online. `if (game.user !== prompter) return;` so exactly one client shows the dialog.
  - Show a DialogV2 Yes/No: *"You have the Alert feat! You can swap your initiative with a willing ally. Swap now?"* → **Yes** ⇒ `runSwapFlow(actor, { combat })`; **No** ⇒ close.

## 7. Ally-picker dialog — shared UI helper

- `promptAllySelection(alertActor, candidates)` → chosen `Combatant` | `null`.
- DialogV2 listing each candidate as `TokenName — init N`; a Cancel returns `null`.

## 8. Settings — `scripts/module.js`

- `autoPrompt` — scope **world**, boolean, **default `true`**. Rationale: an off-by-default helper never reaches the players who forget; the GM can disable per table. Name/hint localized.
- The **button is always available** (primary feature; no toggle in v1).
- Deferred: an optional `showButton` toggle, and/or a per-user client setting so experienced players can opt out of the prompt for themselves.

## 9. Internationalization

- `lang/en.json`, `lang/it.json` (Vittorio's locale). Keys: button label, dialog title/body, Yes/No, "no eligible allies" toast, chat confirmation line, setting name + hint. Registered via `module.json` `languages`.

## 10. Dependencies & manifest

- `module.json`: id, title, v13 `compatibility`, `esmodules: ["scripts/module.js"]`, `languages`, `relationships.recommends`: Visual Active Effects. **No required dependencies.**
- Runtime surface: core Foundry + the `dnd5e.rollInitiative` hook + VAE's `visual-active-effects.createEffectButtons` hook.

## 11. File structure

```
dnd5e-alert-initiative-swap/
  module.json
  scripts/
    module.js      ← init: register settings + hooks
    swap.js        ← pure logic: getAlertFeat, getSwapCandidates, swapInitiative, runSwapFlow
    prompt.js      ← dnd5e.rollInitiative handler + Yes/No + ally-picker dialogs
    vaeButton.js   ← visual-active-effects.createEffectButtons handler
  lang/
    en.json
    it.json
  docs/superpowers/specs/2026-07-06-alert-initiative-swap-design.md
```

## 12. Edge cases

- No combat / combat already started / owner not yet rolled → button absent, prompt skipped, flow no-ops with a toast.
- Owner or all candidates Incapacitated → no candidates → toast, no swap.
- Initiative re-rolled → the button re-evaluates; the auto-prompt one-shot flag prevents re-nag (deliberate: a re-roll does not re-prompt).
- Multiple Alert owners in one combat → independent per-owner prompts, each on that owner's client.
- NPC with Alert → **no** auto-prompt (`hasPlayerOwner` gate); the button remains available to the GM.
- State changes between prompt and confirm → `swapInitiative` re-guards and aborts with a toast.

## 13. Testing

- **node `--test`** (node 25) on `swap.js` pure helpers: candidate filtering (disposition / rolled / incapacitated), the initiative exchange, and the responsible-user selection (mocked `game.users`). Matches the `dnd5e-content-fixups` test style.
- **Live-verify** in `dev-sandbox-v13` via the agent client: button appears only in-window → click → picker → swap; auto-prompt Yes/No path; no re-nag on re-roll; a non-Alert PC is unaffected.
- **Open live-check (same limitation as the DSN nameplate check):** confirming the prompt lands on the *player's* client (Giulio owns Warpey), not the GM, needs simultaneous GM + player logins — one agent browser profile can't do both. The GM-fallback path is verifiable solo.

## 14. Live-integration prerequisites

- Ensure Warpey has an Alert feat with identifier `alert` (CPR premade or DDB). The swap/prompt work off the feat regardless; the **button needs a VAE-rendered effect to hang on** — CPR's Alert transfer effect (init `@prof` bonus) provides it. If Warpey's current Alert lacks such an effect, confirm the anchor before relying on the button.

## 15. Open questions / deferred

- Per-user client opt-out for the prompt — deferred; world setting for v1.
- Optional `showButton` toggle — deferred.
- "Only appears" precision depends on VAE's refresh cadence — best-effort with a callback backstop (never incorrect, possibly one render late to hide).
