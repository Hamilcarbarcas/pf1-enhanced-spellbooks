import { MODULE_ID } from "./const.mjs";
import { registerCategory } from "./config.mjs";
import { registerClassSection } from "./sheet/class-section.mjs";
import { registerSourceSection } from "./sheet/source-section.mjs";
import { registerSpellsTab } from "./sheet/spells-tab.mjs";
import { registerRefresh } from "./apps/shared.mjs";
import { registerOffsetSync, registerSubstitutionSync } from "./sync.mjs";
import { registerSubstitutionNotes } from "./substitute.mjs";
import { registerValueSync } from "./sources.mjs";
import { registerKnownSync } from "./borrow.mjs";
import { registerRest } from "./rest.mjs";
import { registerSettings } from "./settings.mjs";
import { api } from "./api.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerCategory();
  registerClassSection();
  registerSourceSection();
  registerSpellsTab();
  registerRefresh();
  registerSubstitutionSync();
  registerOffsetSync();
  registerSubstitutionNotes();
  registerValueSync();
  registerKnownSync();
  registerRest();

  game.modules.get(MODULE_ID).api = api;
  game.pf1EnhancedSpellbooks = api;
});
