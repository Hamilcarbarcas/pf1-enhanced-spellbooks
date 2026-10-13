/**
 * The spellbook inventory category. DESIGN.md §5.2b, §13.1.
 */

import { SOURCE_SUBTYPE } from "./const.mjs";

// Under the PF1 namespace: the system builds subtype label keys from the subtype itself.
const LABEL = "PF1.Subtypes.Item.loot.spellbook.Plural";

/** Call at `init`, so the system's own setup pass labels the new entries. */
export function registerCategory() {
  const cfg = pf1.config;

  cfg.lootTypes[SOURCE_SUBTYPE] ??= LABEL;
  if (!cfg.unequippableLoot.includes(SOURCE_SUBTYPE)) cfg.unequippableLoot.push(SOURCE_SUBTYPE);

  cfg.sheetSections.inventory[SOURCE_SUBTYPE] ??= {
    label: LABEL,
    filters: [{ type: "loot", subTypes: [SOURCE_SUBTYPE] }],
    // The actions column is where the Open Spellbook button goes. §13.10
    interface: { create: true, actions: true, equip: false },
    browse: { category: "items", type: "loot", lootType: [SOURCE_SUBTYPE] },
    create: { type: "loot", system: { subType: SOURCE_SUBTYPE } },
    // Between Misc (9_000) and Trade Goods (15_000).
    sort: 9_500,
  };
}
