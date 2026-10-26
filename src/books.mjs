/**
 * Per-book settings and the numbers read from the system's spellbook data.
 * DESIGN.md §5.2, §13.3. The only file that knows where PF1 keeps a book (§4.6).
 */

import { ACCESS, MODULE_ID } from "./const.mjs";

const ENHANCED_LINKS = "pf1-enhanced-links";

/** The system's data for one book, or null. */
export function bookData(actor, bookId) {
  return actor?.system?.attributes?.spells?.spellbooks?.[bookId] ?? null;
}

/** Ids of every book the system has on an actor. */
export function bookIds(actor) {
  return Object.keys(actor?.system?.attributes?.spells?.spellbooks ?? {});
}

/** The class item a book belongs to, or null. */
export function bookClass(actor, bookId) {
  const tag = bookData(actor, bookId)?.class;
  if (!tag || tag === "_hd") return null;
  return actor.itemTypes?.class?.find((c) => c.system.tag === tag) ?? null;
}

/** A book's display name. */
export function bookName(actor, bookId) {
  const book = bookData(actor, bookId);
  return book?.label || book?.name || bookClass(actor, bookId)?.name || bookId;
}

/** The feature whose enhanced-links Grant made a book, or null. §26 */
export function bookGranter(actor, bookId) {
  const records = actor?.flags?.[ENHANCED_LINKS]?.spellcastingBooks ?? {};
  const itemId = Object.keys(records).find((id) => records[id]?.book === bookId);
  return (itemId && actor.items?.get(itemId)) || null;
}

/**
 * The item a book's Spellbook settings live on: the feature that granted it, else
 * its class. The class fallback serves actors not yet moved to granted books. §26
 */
export function bookSource(actor, bookId) {
  return bookGranter(actor, bookId) ?? bookClass(actor, bookId);
}

const asAccess = (value) => (value === ACCESS.learned || value === ACCESS.all ? value : null);

/** The access an item's Spellbook setting gives its book, or null. */
export function itemAccess(item) {
  return asAccess(item?.flags?.[MODULE_ID]?.book?.access);
}

/**
 * Whose spellbooks a class may use besides its own, by class tag. The classes that keep
 * spellbooks share them, and the formula-book classes can also read those. §16.1
 */
const SPELLBOOK_CLASSES = ["wizard", "arcanist", "magus"];
const FORMULA_CLASSES = ["alchemist", "investigator"];
const DEFAULT_READS = {
  ...Object.fromEntries(SPELLBOOK_CLASSES.map((tag) => [tag, SPELLBOOK_CLASSES])),
  ...Object.fromEntries(FORMULA_CLASSES.map((tag) => [tag, [...FORMULA_CLASSES, ...SPELLBOOK_CLASSES]])),
};

/** The class tags whose spellbooks a class reads by default: its own, and any it shares with. */
export function defaultReads(tag) {
  return tag ? [...new Set([tag, ...(DEFAULT_READS[tag] ?? [])])] : [];
}

/** The class tags whose spellbooks a book reads: its settings item's list, else the default for its class. */
export function itemReads(item, tag) {
  const own = item?.flags?.[MODULE_ID]?.book?.reads;
  const listed = typeof own === "string" ? own.split(/[,;]/).map((t) => t.trim()).filter(Boolean) : [];
  return listed.length ? listed : defaultReads(tag);
}

/** The class tags whose spellbooks one of an actor's books may use. */
export function readableTags(actor, bookId) {
  const tag = bookData(actor, bookId)?.class;
  return [...new Set([tag, listTag(actor, bookId), ...itemReads(bookSource(actor, bookId), tag)].filter(Boolean))];
}

/** The per-actor settings stored for a book. */
export function bookOverride(actor, bookId) {
  return actor?.flags?.[MODULE_ID]?.books?.[bookId] ?? {};
}

/** Whether an actor's classes use their Spellbook setting. Unset: player characters only. §13.3 */
export function usesSpellbooks(actor) {
  const flag = actor?.flags?.[MODULE_ID]?.useSpellbooks;
  return typeof flag === "boolean" ? flag : actor?.type === "character";
}

/** Effective settings for one book. §13.3 */
export function getConfig(actor, bookId) {
  const book = bookData(actor, bookId);
  if (!book || bookId === "spelllike" || !book.inUse) {
    return { managed: false, access: null, mode: null, primary: null };
  }

  const over = bookOverride(actor, bookId);
  const access = asAccess(over.access) ?? itemAccess(bookSource(actor, bookId));
  return {
    managed: usesSpellbooks(actor) && !!access,
    access,
    mode: book.spellPreparationMode || "prepared",
    primary: over.primary ?? null,
  };
}

/** Ids of the books that have a Spellbook. */
export function getManagedBooks(actor) {
  return bookIds(actor).filter((id) => getConfig(actor, id).managed);
}

/** Store one per-actor setting for a book. `null` returns it to the default. */
export async function setOverride(actor, bookId, key, value) {
  return actor.update({ [`flags.${MODULE_ID}.books.${bookId}.${key}`]: value });
}

/** The class tag a book reads spell levels from. §13.3 */
export function listTag(actor, bookId) {
  return actor?.flags?.[ENHANCED_LINKS]?.bookLists?.[bookId] || bookData(actor, bookId)?.class || "";
}

/** Whether a class list has a spell. Takes a document or an index entry. */
export function isOnList(spell, tag) {
  if (!tag) return false;
  const learned = spell?.system?.learnedAt?.class ?? {};
  return Object.entries(learned).some(([key, level]) => Number.isFinite(level) && key.split("/").includes(tag));
}

/** A spell's level on a class list, else its own. Takes a document or an index entry. */
export function spellLevelFor(spell, tag) {
  const learned = spell?.system?.learnedAt?.class ?? {};
  if (tag) {
    if (Number.isFinite(learned[tag])) return learned[tag];
    for (const [key, level] of Object.entries(learned)) {
      if (Number.isFinite(level) && key.split("/").includes(tag)) return level;
    }
  }
  const own = spell?.system?.level;
  return Number.isFinite(own) ? own : 0;
}

/** Slots per spell level, from the system's derived numbers. §13.1 */
export function getSlots(actor, bookId) {
  const book = bookData(actor, bookId);
  // A hybrid book's daily choice is a number of spells, not its casts. §3.1
  const hybrid = book?.spellPreparationMode === "hybrid";
  const out = [];
  for (let level = 0; level <= 9; level++) {
    const data = book?.spells?.[`spell${level}`];
    const regular = hybrid ? data?.preparation?.max : data?.slots?.max;
    out.push({
      level,
      // NaN marks a level the book can't cast. Cantrips cast without limit: Infinity.
      castable: typeof data?.max === "number" && !Number.isNaN(data.max),
      regular: Math.max(0, Number(regular) || 0),
      special: level > 0 ? Math.max(0, Number(data?.domain?.max) || 0) : 0,
    });
  }
  return out;
}

/** Whether a book's special slots are school slots, by the system's own rule; else domain. */
export function isSchoolBook(actor, bookId) {
  const book = bookData(actor, bookId);
  return book?.isSchool ?? book?.kind !== "divine";
}

/** How many times one spell may be prepared. A hybrid book prepares each spell once. */
export function spellCap(actor, bookId) {
  return bookData(actor, bookId)?.spellPreparationMode === "hybrid" ? 1 : Infinity;
}

/** Id of the profile that always holds the last loadout applied. §13.11 */
export const PREVIOUS_PROFILE = "previous";

/** Saved loadouts for a book as `[{ id, name, plan, previous }]`, the last applied one first. §13.7 */
export function getProfiles(actor, bookId) {
  const stored = bookOverride(actor, bookId).profiles ?? {};
  const named = Object.entries(stored)
    .filter(([id, profile]) => id !== PREVIOUS_PROFILE && profile?.name)
    .map(([id, profile]) => ({ id, name: profile.name, plan: profile.plan ?? [], previous: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const last = stored[PREVIOUS_PROFILE];
  if (!last) return named;
  const name = game.i18n.localize("PF1ESB.Prep.Previous");
  return [{ id: PREVIOUS_PROFILE, name, plan: last.plan ?? [], previous: true }, ...named];
}

/** Save a loadout under a name, replacing one of the same name. Returns its id. */
export async function saveProfile(actor, bookId, name, plan) {
  const named = getProfiles(actor, bookId).filter((p) => !p.previous);
  const id = named.find((p) => p.name === name)?.id ?? foundry.utils.randomID();
  await actor.update({ [`flags.${MODULE_ID}.books.${bookId}.profiles.${id}`]: { name, plan } });
  return id;
}

/** Record the loadout just applied. Overwritten by the next one. */
export async function savePrevious(actor, bookId, plan) {
  return actor.update({ [`flags.${MODULE_ID}.books.${bookId}.profiles.${PREVIOUS_PROFILE}`]: { plan } });
}

export async function deleteProfile(actor, bookId, id) {
  if (id === PREVIOUS_PROFILE) return;
  return actor.update({ [`flags.${MODULE_ID}.books.${bookId}.profiles.-=${id}`]: null });
}
