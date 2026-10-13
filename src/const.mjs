export const MODULE_ID = "pf1-enhanced-spellbooks";

/** CSS namespace; matches the `PREFIX` var in common.json. */
export const CSS = "pfesb-";

export const TEMPLATES = `modules/${MODULE_ID}/src/templates`;

export const LOG = "PF1 Enhanced Spellbooks |";

/** Loot subtype of an item that holds a spell list. DESIGN.md §5.2b */
export const SOURCE_SUBTYPE = "spellbook";

/** Where a book's spells come from. DESIGN.md §3.1 */
export const ACCESS = { learned: "learned", all: "all" };

/** Slot kinds a spell can be prepared in. DESIGN.md §5.5 */
export const SLOT = { regular: "regular", special: "special" };

/** Fired after a book's preparation is written. DESIGN.md §13.4 */
export const HOOK_PREPARED = `${MODULE_ID}.prepared`;
