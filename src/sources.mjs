/**
 * Source items: the inventory items that hold a caster's known spells as links.
 * DESIGN.md §5.2b, §5.3, §13.3.
 */

import { ACCESS, MODULE_ID, SOURCE_SUBTYPE } from "./const.mjs";
import { traitsOf } from "./rules.mjs";
import {
  bookOverride,
  getConfig,
  getManagedBooks,
  isOnList,
  listTag,
  readableTags,
  spellLevelFor,
} from "./books.mjs";

const FLAG = "source";
const INDEX_FIELDS = [
  "system.learnedAt.class",
  "system.level",
  "system.school",
  "system.subschool",
  "system.descriptors",
];

/** How a spell is charged against a book's pages. */
export const PAGE_COST = { level: "level", spell: "spell" };
/** What kind of thing holds the list. Only a book has pages and a price that follows them. §23 */
export const SOURCE_TYPE = { book: "book", familiar: "familiar" };
/** What a cantrip adds to a spellbook's value, in gp. Other spells: level × 10 × pages. */
const CANTRIP_VALUE = 5;
const LEVEL_VALUE = 10;

/** Packs whose index already carries INDEX_FIELDS this session. */
const indexed = new Set();

const flagOf = (item) => item?.flags?.[MODULE_ID]?.[FLAG] ?? {};

/** Whether an item holds a spell list. */
export function isSource(item) {
  return item?.type === "loot" && item.system?.subType === SOURCE_SUBTYPE;
}

/** Source items on an actor, those inside containers included. */
export function getSources(actor) {
  return [...(actor?.allItems ?? actor?.items ?? [])].filter(isSource);
}

/**
 * On an actor, not used up, and carried. A contained item's own `carried` is forced
 * true by the system, so the outermost container decides. §13.1
 */
export function isAvailable(item) {
  if (!item?.actor) return false;
  if ((item.system?.quantity ?? 1) <= 0) return false;
  return (item.rootItem ?? item).system?.carried !== false;
}

/** A source item's settings, with defaults filled in. §13.3 */
export function getSourceConfig(item) {
  const flag = flagOf(item);
  const pages = Math.floor(Number(flag.pages));
  const maxLevel = flag.maxLevel == null || flag.maxLevel === "" ? NaN : Math.floor(Number(flag.maxLevel));
  return {
    // Class tag the book is written for. Blank: any class may use it.
    class: typeof flag.class === "string" ? flag.class.trim() : "",
    // 0: no page limit.
    pages: pages > 0 ? pages : 0,
    pageCost: flag.pageCost === PAGE_COST.spell ? PAGE_COST.spell : PAGE_COST.level,
    maxLevel: Number.isFinite(maxLevel) ? Math.clamp(maxLevel, 0, 9) : 9,
    type: flag.type === SOURCE_TYPE.familiar ? SOURCE_TYPE.familiar : SOURCE_TYPE.book,
    // Whose it is, as an actor's name. Blank: the book that has chosen it. §21.2
    owner: typeof flag.owner === "string" ? flag.owner.trim() : "",
    // The same owner by actor id, which survives a rename where the name survives a copy.
    ownerId: typeof flag.ownerId === "string" ? flag.ownerId : "",
    // What the book costs empty, in gp. Null until its value is first worked out. §23
    baseValue: Number.isFinite(Number(flag.baseValue)) && flag.baseValue !== null && flag.baseValue !== "" ? Math.max(0, Number(flag.baseValue)) : null,
  };
}

/** Store one of a source item's settings. */
export async function setSourceConfig(item, key, value) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG}.${key}`]: value });
}

/** Pages a list of resolved entries takes. Per level, a cantrip still takes one. */
export function pagesUsed(resolved, pageCost) {
  return resolved.reduce((sum, entry) => sum + spellPages(entry.level, pageCost), 0);
}

/** Pages one spell takes: one, or one per spell level with a cantrip taking one. */
export function spellPages(level, pageCost) {
  if (pageCost === PAGE_COST.spell) return 1;
  return Math.max(1, Math.floor(Number(level) || 0));
}

/** What one spell adds to a spellbook's value, in gp. §23 */
export function spellValue(level, pageCost) {
  const lvl = Math.max(0, Math.floor(Number(level) || 0));
  return lvl === 0 ? CANTRIP_VALUE : lvl * LEVEL_VALUE * spellPages(lvl, pageCost);
}

/** A spellbook's value: what it costs empty plus what each spell in it adds. */
export function bookValue(resolved, pageCost, base = 0) {
  return resolved.reduce((sum, entry) => sum + spellValue(entry.level, pageCost), Number(base) || 0);
}

/**
 * Whether a book may use a source item: the item names no class, or names one whose
 * spellbooks the book's class reads. §16.1
 */
export function isEligible(actor, bookId, item) {
  const wanted = getSourceConfig(item).class;
  return !wanted || readableTags(actor, bookId).includes(wanted);
}

/** The source items on an actor that a book may use. */
export function eligibleSources(actor, bookId) {
  return getSources(actor).filter((item) => isEligible(actor, bookId, item));
}

/** The Learned books on an actor that may use a source item. */
export function eligibleBooks(actor, item) {
  return getManagedBooks(actor).filter(
    (bookId) => getConfig(actor, bookId).access === ACCESS.learned && isEligible(actor, bookId, item)
  );
}

/** The key that identifies a source item across container moves, or null. */
export function sourceKey(item) {
  return flagOf(item).key ?? null;
}

async function ensureKey(item) {
  const existing = sourceKey(item);
  if (existing) return existing;
  const key = foundry.utils.randomID();
  await item.update({ [`flags.${MODULE_ID}.${FLAG}.key`]: key }, { render: false });
  return key;
}

/**
 * A spell list lives in one of two places: on a source item, or on the actor as a
 * book's favored spells (§13.12). Everything below takes either a source item or a
 * `{ doc, path }` list, and works on the document and flag path it names.
 */
function listOf(target) {
  if (target?.documentName === "Item") return { doc: target, path: `flags.${MODULE_ID}.${FLAG}` };
  return target?.doc && target.path ? target : null;
}

const listData = (list) => (list ? foundry.utils.getProperty(list.doc, list.path) ?? {} : {});

/** The favored spells of a book that prepares from its whole class list. §13.12 */
export function favoredList(actor, bookId) {
  return { doc: actor, path: `flags.${MODULE_ID}.books.${bookId}.favored` };
}

/**
 * A list's entries as `[{ id, uuid, name, combat, quick }]`. The two marks are the
 * defaults a spell takes when it is added to a loadout. §13.11
 */
export function getEntries(target) {
  return Object.entries(listData(listOf(target)).entries ?? {})
    .filter(([, entry]) => entry?.uuid)
    .map(([id, entry]) => ({
      id,
      uuid: entry.uuid,
      name: entry.name ?? "",
      combat: entry.combat === true,
      quick: entry.quick === true,
    }));
}

/** Set one of an entry's default marks, `combat` or `quick`. */
export async function setEntryMark(target, entryId, mark, value) {
  const list = listOf(target);
  if (!list || !(entryId in (listData(list).entries ?? {}))) return;
  return list.doc.update({ [`${list.path}.entries.${entryId}.${mark}`]: !!value });
}

/** A book's own source item, or null. An available copy wins over one left behind. */
export function getPrimary(actor, bookId) {
  const key = bookOverride(actor, bookId).primary;
  if (!key) return null;
  const matches = getSources(actor).filter((item) => sourceKey(item) === key);
  return matches.find(isAvailable) ?? matches[0] ?? null;
}

/**
 * What a book prepares from: its own source item, or its favored spells when it has
 * the whole class list. `target` is what `getEntries`, `learn`, and the rest take.
 *
 * @returns {{kind: "source"|"favored"|null, target: Item|object|null, item: Item|null, available: boolean}}
 */
export function getBookList(actor, bookId) {
  const cfg = getConfig(actor, bookId);
  if (!cfg.managed) return { kind: null, target: null, item: null, available: false };
  if (cfg.access === ACCESS.all) {
    return { kind: "favored", target: favoredList(actor, bookId), item: null, available: true };
  }
  const item = getPrimary(actor, bookId);
  return { kind: "source", target: item, item, available: !!item && isAvailable(item) };
}

/** Make an item a book's own source. `null` clears it. */
export async function setPrimary(actor, bookId, item) {
  let key = null;
  if (item) {
    if (!isSource(item) || item.actor !== actor) throw new Error("Not a spellbook item on this actor.");
    key = await ensureKey(item);
  }
  await actor.update({ [`flags.${MODULE_ID}.books.${bookId}.primary`]: key });
  return key;
}

/** Why a document can't be learned, or null. §13.3 */
function refusal(doc) {
  if (!doc) return "missing";
  if (doc.documentName !== "Item" || doc.type !== "spell") return "notSpell";
  if (doc.isEmbedded) return "embedded";
  return null;
}

/**
 * Add spells to a list.
 *
 * @param {Item|object} target     A source item, or a `{ doc, path }` list.
 * @param {string|string[]} uuids  Spells in a compendium or the world.
 * @returns {Promise<{added: object[], refused: {uuid: string, reason: string}[]}>}
 */
export async function learn(target, uuids) {
  const list = listOf(target);
  const item = list?.doc.documentName === "Item" ? list.doc : null;
  if (!list || (item && !isSource(item))) throw new Error("Not a spell list.");

  const have = new Set(getEntries(list).map((entry) => entry.uuid));
  const update = {};
  const added = [];
  const refused = [];

  // A book with a page count holds no more than fits. §23
  const cfg = item ? getSourceConfig(item) : null;
  let room = Infinity;
  if (cfg?.type === SOURCE_TYPE.book && cfg.pages > 0) {
    const held = (await resolveEntries(getEntries(list), cfg.class)).filter((entry) => !entry.missing);
    room = cfg.pages - pagesUsed(held, cfg.pageCost);
  }

  for (const uuid of [uuids].flat()) {
    const doc = await fromUuid(uuid).catch(() => null);
    const reason = refusal(doc);
    if (reason) {
      refused.push({ uuid, reason });
      continue;
    }
    if (have.has(doc.uuid)) continue;
    const need = Number.isFinite(room) ? spellPages(spellLevelFor(doc, cfg.class), cfg.pageCost) : 0;
    if (need > room) {
      refused.push({ uuid, reason: "noRoom" });
      continue;
    }
    room -= need;
    const id = foundry.utils.randomID();
    const entry = { uuid: doc.uuid, name: doc.name };
    update[`${list.path}.entries.${id}`] = entry;
    have.add(doc.uuid);
    added.push({ id, ...entry });
  }

  if (added.length) {
    if (item && !sourceKey(item)) update[`${list.path}.key`] = foundry.utils.randomID();
    await list.doc.update(update);
  }
  return { added, refused };
}

/** Remove entries from a list by entry id. */
export async function forget(target, entryIds) {
  const list = listOf(target);
  if (!list) return;
  const entries = listData(list).entries ?? {};
  const update = {};
  for (const id of [entryIds].flat()) {
    if (id in entries) update[`${list.path}.entries.-=${id}`] = null;
  }
  if (Object.keys(update).length) await list.doc.update(update);
}

/**
 * Entries with what a list view needs, read from pack indexes so no spell is loaded.
 * A link that no longer resolves comes back with `missing: true`.
 *
 * @param {{id: string, uuid: string, name: string}[]} entries
 * @param {string} tag  Class tag the levels are read for.
 */
export async function resolveEntries(entries, tag) {
  const parsed = entries.map((entry) => {
    let ref = null;
    try {
      ref = foundry.utils.parseUuid(entry.uuid);
    } catch {
      ref = null;
    }
    return { entry, ref };
  });

  const packs = new Set();
  for (const { ref } of parsed) {
    const pack = ref?.collection;
    if (pack?.getIndex && !indexed.has(pack.collection)) packs.add(pack);
  }
  await Promise.all(
    [...packs].map(async (pack) => {
      await pack.getIndex({ fields: INDEX_FIELDS });
      indexed.add(pack.collection);
    })
  );

  return parsed.map(({ entry, ref }) => {
    const pack = ref?.collection;
    const found = pack?.index ? pack.index.get(ref.id) : pack?.get?.(ref?.id);
    if (!found) return { ...entry, missing: true, level: null, img: null, school: null, onList: false };
    return {
      ...entry,
      missing: false,
      name: found.name ?? entry.name,
      img: found.img ?? null,
      type: found.type ?? null,
      school: found.system?.school ?? null,
      // For matching slot rules. §14
      subschools: traitsOf(found).subschools,
      descriptors: traitsOf(found).descriptors,
      level: spellLevelFor(found, tag),
      // Whether the class list names the spell at all.
      onList: isOnList(found, tag),
    };
  });
}

/**
 * Bring a spellbook's price in line with what it holds: its empty value plus each
 * spell's. The first time, the price it has becomes its empty value. A familiar has no
 * such price and is left alone. §23
 */
export async function syncValue(item) {
  if (!isSource(item) || !item.isOwner) return;
  const cfg = getSourceConfig(item);
  if (cfg.type !== SOURCE_TYPE.book) return;

  const update = {};
  let base = cfg.baseValue;
  if (base === null) {
    base = Math.max(0, Number(item.system?.price) || 0);
    update[`flags.${MODULE_ID}.${FLAG}.baseValue`] = base;
  }
  const held = (await resolveEntries(getEntries(item), cfg.class)).filter((entry) => !entry.missing);
  const price = Math.round(bookValue(held, cfg.pageCost, base) * 100) / 100;
  if (price !== Number(item.system?.price)) update["system.price"] = price;
  if (Object.keys(update).length) await item.update(update);
}

/** Keep spellbook prices current as their spells and settings change. */
export function registerValueSync() {
  const watched = ["entries", "pageCost", "baseValue", "type", "class"];
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId !== game.user.id || !isSource(item)) return;
    const changed = changes?.flags?.[MODULE_ID]?.[FLAG];
    if (!changed || !watched.some((key) => key in changed)) return;
    syncValue(item).catch((err) => console.error("pf1-enhanced-spellbooks |", "updating a spellbook's value failed", err));
  });
}
