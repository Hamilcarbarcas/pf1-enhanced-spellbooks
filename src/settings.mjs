/**
 * World settings. DESIGN.md §25.
 */

import { MODULE_ID } from "./const.mjs";

/** Spells can only be applied from the Prepare Spells window after a rest has offered it. */
const REST_ONLY = "restOnly";

export function registerSettings() {
  game.settings.register(MODULE_ID, REST_ONLY, {
    name: "PF1ESB.Settings.RestOnly.Name",
    hint: "PF1ESB.Settings.RestOnly.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}

export const restOnly = () => game.settings.get(MODULE_ID, REST_ONLY) === true;
