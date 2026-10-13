/**
 * Preparation: the copies of prepared spells on the actor, the marked spells that
 * fill special slots, and the write that moves a book from one day's list to the
 * next. DESIGN.md §5.5, §5.6, §13.4, §13.11, §13.12.
 */

import { HOOK_PREPARED, LOG, MODULE_ID, SLOT } from "./const.mjs";
import { bookData, getConfig, getSlots, listTag, spellLevelFor } from "./books.mjs";

const ENHANCED_LINKS = "pf1-enhanced-links";
import { getGroups } from "./rules.mjs";
import { substitutionSpells } from "./substitute.mjs";
import { applyMetamagic, getMetamagics } from "./metamagic.mjs";

const FLAG = "copy";
/** Flag on a spell item that is not a copy: the marks it takes when next prepared. */
const DEFAULTS = "marks";

/** The two marks a spell can carry, and the system field each one drives. §13.12 */
export const MARKS = { combat: "showInCombat", quick: "showInQuickbar" };

const copyOf = (item) => item?.flags?.[MODULE_ID]?.[FLAG] ?? null;
const asSlot = (slot) => (slot === SLOT.special ? SLOT.special : SLOT.regular);
const asMeta = (meta) => [...new Set((Array.isArray(meta) ? meta : []).filter(Boolean).map(String))].sort();
const asCount = (count) => Math.max(0, Math.floor(Number(count) || 0));
const asMark = (value) => (value === undefined || value === null ? undefined : !!value);
const asRule = (slot, rule) => (slot === SLOT.special && rule ? String(rule) : null);
const asCost = (cost) => Math.max(1, Math.floor(Number(cost) || 1));
const keyOf = (uuid, slot, meta, rule) => `${uuid}|${slot}${rule ? `:${rule}` : ""}|${meta.join(",")}`;

/**
 * The identity of one line of a preparation: spell, slot kind, the slot rule it sits
 * under when the slot is a special one, and metamagic. §13.4, §14
 */
export function planKey(uuid, slot, meta, rule = null) {
  return keyOf(uuid, asSlot(slot), asMeta(meta), asRule(asSlot(slot), rule));
}

const isHybrid = (actor, bookId) => bookData(actor, bookId)?.spellPreparationMode === "hybrid";

/** How many times a spell item is prepared, by the book's own notion of prepared. */
function preparedCount(spell, hybrid) {
  const prep = spell.system?.preparation ?? {};
  return (hybrid ? prep.value : prep.max) ?? 0;
}

/** A spell item's marks as they stand on the sheet right now. */
function liveMarks(spell) {
  return { combat: spell.system.showInCombat === true, quick: spell.system.showInQuickbar === true };
}

/**
 * The marks a spell item on the actor takes when it is next prepared. Kept apart from
 * the live ones, which are cleared while the spell is unprepared.
 */
function defaultMarks(spell) {
  const stored = spell.flags?.[MODULE_ID]?.[DEFAULTS] ?? {};
  const live = liveMarks(spell);
  return { combat: stored.combat ?? live.combat, quick: stored.quick ?? live.quick };
}

/** The prepared copies in a book. */
export function getCopies(actor, bookId) {
  return (actor?.itemTypes?.spell ?? []).filter(
    (spell) => spell.system?.spellbook === bookId && copyOf(spell)?.uuid
  );
}

/** A spell item on the actor as the Prepare window lists it. */
function actorSpell(spell, hybrid) {
  return {
    itemId: spell.id,
    uuid: spell.uuid,
    name: spell.name,
    img: spell.img,
    level: spell.system.level,
    count: preparedCount(spell, hybrid),
    marked: spell.system?.domain === true,
    ...defaultMarks(spell),
  };
}

/**
 * The marked spells that sit on the actor itself: granted domain spells and the like.
 * Only these can fill a book's special slots. §5.6
 */
export function getSpecialCandidates(actor, bookId) {
  const hybrid = isHybrid(actor, bookId);
  return (actor?.itemTypes?.spell ?? [])
    .filter((spell) => spell.system?.spellbook === bookId && spell.system?.domain === true && !copyOf(spell))
    .map((spell) => actorSpell(spell, hybrid));
}

/** Whether a feature put a spell on the actor through pf1-enhanced-links. */
export function isGranted(spell) {
  return !!spell?.flags?.[ENHANCED_LINKS]?.grantParent;
}

/**
 * The unmarked spells a feature has put on the actor, such as a witch's patron spells.
 * They are prepared in ordinary slots straight from the actor, with no spellbook, and
 * go when the feature goes. A spell dropped on the Spells tab by hand is not one. §24
 */
export function getGrantedSpells(actor, bookId) {
  const hybrid = isHybrid(actor, bookId);
  return (actor?.itemTypes?.spell ?? [])
    .filter(
      (spell) =>
        spell.system?.spellbook === bookId &&
        spell.system?.domain !== true &&
        !spell.system?.atWill &&
        !copyOf(spell) &&
        isGranted(spell)
    )
    .map((spell) => actorSpell(spell, hybrid));
}

/** Every spell item on the actor that a book prepares as it stands: marked, and granted. */
export function getActorSpells(actor, bookId) {
  return [...getSpecialCandidates(actor, bookId), ...getGrantedSpells(actor, bookId)];
}

/** Set the mark, `combat` or `quick`, that a spell item on the actor takes when next prepared. */
export async function setItemMark(item, mark, value) {
  if (!(mark in MARKS)) return;
  return item.update({ [`flags.${MODULE_ID}.${DEFAULTS}.${mark}`]: !!value });
}

/** Today's preparation: one line per copy, and one per spell item on the actor that is prepared. */
export function getPreparation(actor, bookId) {
  const hybrid = isHybrid(actor, bookId);
  // An entry kept only to be cast by substitution is not part of the loadout. §15
  const copies = getCopies(actor, bookId).filter((spell) => !copyOf(spell).sub);
  const lines = copies.map((spell) => {
    const copy = copyOf(spell);
    return {
      uuid: copy.uuid,
      slot: asSlot(copy.slot),
      rule: asRule(asSlot(copy.slot), copy.rule),
      cost: asCost(spell.system.slotCost),
      marked: spell.system.domain === true,
      meta: asMeta(copy.meta),
      count: preparedCount(spell, hybrid),
      left: spell.system.preparation?.value ?? 0,
      level: spell.system.level,
      // Without the metamagic names a copy carries in front of its own. §20
      name: copy.baseName ?? spell.name,
      itemId: spell.id,
      ...liveMarks(spell),
    };
  });
  for (const spell of getActorSpells(actor, bookId)) {
    if (spell.count <= 0) continue;
    lines.push({
      granted: true,
      itemId: spell.itemId,
      slot: spell.marked ? SLOT.special : SLOT.regular,
      marked: spell.marked,
      meta: [],
      count: spell.count,
      level: spell.level,
      name: spell.name,
      ...liveMarks(actor.items.get(spell.itemId)),
    });
  }
  return lines;
}

/**
 * Split a plan into copies wanted (by key) and spell items wanted (by item id),
 * merging duplicates and dropping empty lines.
 */
function normalize(plan) {
  const wanted = new Map();
  const granted = new Map();
  for (const raw of plan ?? []) {
    const count = asCount(raw?.count);
    if (count <= 0) continue;
    const marks = { combat: asMark(raw.combat), quick: asMark(raw.quick) };
    if (raw.itemId && !raw.uuid) {
      const prior = granted.get(raw.itemId);
      if (prior) prior.count += count;
      else granted.set(raw.itemId, { count, ...marks });
      continue;
    }
    if (!raw.uuid) continue;
    const slot = asSlot(raw.slot);
    const meta = asMeta(raw.meta);
    const rule = asRule(slot, raw.rule);
    const key = keyOf(raw.uuid, slot, meta, rule);
    const prior = wanted.get(key);
    if (prior) prior.count += count;
    else {
      wanted.set(key, {
        uuid: raw.uuid,
        slot,
        rule,
        meta,
        count,
        // Slots the spell takes, and whether it draws on the system's special pool. §14
        cost: asCost(raw.cost),
        marked: raw.marked === undefined ? slot === SLOT.special : !!raw.marked,
        ...marks,
      });
    }
  }
  return { wanted, granted };
}

/** Add to `update` what moves a spell item to a new prepared count. */
function countChange(update, spell, count, hybrid) {
  const prep = spell.system.preparation ?? {};
  const max = prep.max ?? 0;
  const value = prep.value ?? 0;
  // A hybrid book reads `value` as prepared and never spends it.
  if (hybrid) {
    if (max === count && value === count) return;
    update["system.preparation.max"] = count;
    update["system.preparation.value"] = count;
    return;
  }
  if (max === count) return;
  update["system.preparation.max"] = count;
  // Uses already spent stay spent.
  update["system.preparation.value"] = Math.clamp(value + (count - max), 0, count);
}

/** Add to `update` what brings a prepared spell's live marks in line. An undefined mark is left alone. */
function markChange(update, spell, want) {
  for (const [mark, field] of Object.entries(MARKS)) {
    if (want[mark] !== undefined && (spell.system[field] === true) !== want[mark]) {
      update[`system.${field}`] = want[mark];
    }
  }
}

/**
 * Add to `update` what takes an unprepared spell off the Combat tab and quick actions.
 * What it had is kept as its default, so it comes back with them when next prepared.
 */
function markClear(update, spell) {
  const stored = spell.flags?.[MODULE_ID]?.[DEFAULTS] ?? {};
  for (const [mark, field] of Object.entries(MARKS)) {
    if (spell.system[field] !== true) continue;
    update[`system.${field}`] = false;
    if (stored[mark] === undefined) update[`flags.${MODULE_ID}.${DEFAULTS}.${mark}`] = true;
  }
}

/**
 * What keeps the Spells tab's substitution entries in step: an unprepared copy of each
 * spell that can be cast by substitution and is not prepared in its own right. §15
 *
 * @param {Set<string>} preparedUuids  Source uuids that will have a prepared copy.
 * @returns {Promise<{toDelete: string[], toCreate: object[]}>}
 */
async function substitutionChanges(actor, bookId, preparedUuids) {
  const wanted = new Set(await substitutionSpells(actor, bookId));
  const tag = listTag(actor, bookId);
  const toDelete = [];
  const have = new Set();
  for (const spell of getCopies(actor, bookId)) {
    const copy = copyOf(spell);
    if (!copy.sub) continue;
    if (wanted.has(copy.uuid) && !preparedUuids.has(copy.uuid) && !have.has(copy.uuid)) have.add(copy.uuid);
    else toDelete.push(spell.id);
  }

  const toCreate = [];
  for (const uuid of wanted) {
    if (preparedUuids.has(uuid) || have.has(uuid)) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.documentName !== "Item" || doc.type !== "spell") continue;
    const want = { uuid, slot: SLOT.regular, rule: null, meta: [], count: 0, cost: 1, marked: false };
    const data = await copyData(doc, want, bookId, tag);
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}.sub`, true);
    // After everything that is prepared.
    data.sort = 1_000_000;
    toCreate.push(data);
  }
  return { toDelete, toCreate };
}

const FLEX_ICON = "icons/svg/aura.svg";

/**
 * What keeps a book's flexible slots in step. A flexible group has no spell chosen at
 * preparation, so each castable level gets a stand-in spell item that holds the slot:
 * marked, prepared as many times as the group has slots, spent when a spell is cast
 * from it, and restored on rest like any prepared spell. §17
 *
 * @returns {{toDelete: string[], toUpdate: object[], toCreate: object[]}}
 */
function flexChanges(actor, bookId) {
  const wanted = new Map();
  const groups = getGroups(actor, bookId).filter((group) => group.flexible && group.capacity > 0);
  const levels = getSlots(actor, bookId).filter((slot) => slot.castable && slot.level > 0);
  for (const group of groups) for (const slot of levels) wanted.set(`${group.key}|${slot.level}`, group);

  const nameOf = (group) => group.name || game.i18n.localize("PF1ESB.Flex.Name");
  const toDelete = [];
  const toUpdate = [];
  const seen = new Set();
  for (const spell of actor.itemTypes.spell) {
    const key = copyOf(spell)?.flex;
    if (!key || spell.system?.spellbook !== bookId) continue;
    const id = `${key}|${spell.system.level}`;
    const group = wanted.get(id);
    if (!group || seen.has(id)) {
      toDelete.push(spell.id);
      continue;
    }
    seen.add(id);
    const update = { _id: spell.id };
    countChange(update, spell, group.capacity, false);
    if (spell.name !== nameOf(group)) update.name = nameOf(group);
    if (Object.keys(update).length > 1) toUpdate.push(update);
  }

  const toCreate = [];
  for (const [id, group] of wanted) {
    if (seen.has(id)) continue;
    toCreate.push({
      name: nameOf(group),
      type: "spell",
      img: FLEX_ICON,
      // Ahead of the level's other spells.
      sort: 1,
      system: {
        spellbook: bookId,
        level: Number(id.slice(id.lastIndexOf("|") + 1)),
        domain: true,
        preparation: { value: group.capacity, max: group.capacity },
      },
      flags: { [MODULE_ID]: { [FLAG]: { flex: group.key } } },
    });
  }
  return { toDelete, toUpdate, toCreate };
}

/**
 * Bring a book's substitution entries and flexible slots in step with its rules and
 * list, leaving what is prepared alone. For when a rule or the list changes between
 * preparations.
 */
export async function syncSubstitutions(actor, bookId) {
  const cfg = getConfig(actor, bookId);
  if (!cfg.managed || cfg.mode !== "prepared") return;
  const prepared = new Set(
    getCopies(actor, bookId)
      .filter((spell) => !copyOf(spell).sub)
      .map((spell) => copyOf(spell).uuid)
  );
  const subs = await substitutionChanges(actor, bookId, prepared);
  const flex = flexChanges(actor, bookId);
  const toDelete = [...subs.toDelete, ...flex.toDelete];
  const toCreate = [...subs.toCreate, ...flex.toCreate];
  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (flex.toUpdate.length) await actor.updateEmbeddedDocuments("Item", flex.toUpdate);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}

/** Creation data for one copy. `metamagics` is what the actor has, for a copy prepared with any. */
async function copyData(doc, want, bookId, tag, metamagics = []) {
  const data = game.items.fromCompendium(doc, { clearFolder: true });
  foundry.utils.setProperty(data, "system.spellbook", bookId);
  foundry.utils.setProperty(data, "system.level", Math.clamp(spellLevelFor(doc, tag), 0, 9));
  foundry.utils.setProperty(data, "system.preparation.value", want.count);
  foundry.utils.setProperty(data, "system.preparation.max", want.count);
  foundry.utils.setProperty(data, "system.domain", want.marked);
  foundry.utils.setProperty(data, "system.slotCost", want.cost);
  for (const [mark, field] of Object.entries(MARKS)) {
    foundry.utils.setProperty(data, `system.${field}`, want[mark] === true);
  }
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, {
    uuid: want.uuid,
    slot: want.slot,
    rule: want.rule,
    meta: want.meta,
    baseName: doc.name,
  });
  // Last, so the spell moves to its metamagic's slot from the level set above. §20.2
  if (want.meta.length) await applyMetamagic(data, want.meta, metamagics);
  return data;
}

/**
 * Set a book's preparation, writing only what changed. The plan is the whole day's
 * loadout: any spell in the book that it leaves out ends up unprepared, copies
 * removed and spell items already on the actor set to nothing prepared and taken
 * off the Combat tab and quick actions.
 *
 * @param {Actor} actor
 * @param {string} bookId
 * @param {object[]} plan  `{ uuid, slot?, rule?, count, meta?, cost?, marked? }` for a spell from a list,
 *                         `{ itemId, count }` for a spell item already on the actor.
 *                         Either may carry `combat` and `quick` marks.
 * @returns {Promise<{created: number, updated: number, deleted: number, missing: string[]}>}
 */
export async function setPreparation(actor, bookId, plan) {
  const cfg = getConfig(actor, bookId);
  if (!cfg.managed) throw new Error(`${LOG} "${bookId}" has no Spellbook on ${actor?.name}.`);
  // A spontaneous book prepares nothing, and this would unprepare everything it knows.
  if (cfg.mode === "spontaneous") throw new Error(`${LOG} "${bookId}" is a spontaneous book.`);

  const { wanted, granted } = normalize(plan);
  const tag = listTag(actor, bookId);
  const hybrid = isHybrid(actor, bookId);
  const metamagics = getMetamagics(actor);

  const toDelete = [];
  const updates = new Map();
  const updateOf = (spell) => {
    if (!updates.has(spell.id)) updates.set(spell.id, { _id: spell.id });
    return updates.get(spell.id);
  };
  const kept = new Set();
  // Everything that ends up prepared, for ordering the Spells tab.
  const prepared = [];

  for (const spell of getCopies(actor, bookId)) {
    const copy = copyOf(spell);
    // Substitution entries are settled separately, below.
    if (copy.sub) continue;
    const slot = asSlot(copy.slot);
    const key = keyOf(copy.uuid, slot, asMeta(copy.meta), asRule(slot, copy.rule));
    const want = wanted.get(key);
    // A second copy under one key is a stray.
    if (!want || kept.has(key)) {
      toDelete.push(spell.id);
      continue;
    }
    kept.add(key);
    countChange(updateOf(spell), spell, want.count, hybrid);
    markChange(updateOf(spell), spell, want);
    if (asCost(spell.system.slotCost) !== want.cost) updateOf(spell)["system.slotCost"] = want.cost;
    if ((spell.system.domain === true) !== want.marked) updateOf(spell)["system.domain"] = want.marked;
    prepared.push({ special: want.slot === SLOT.special, name: spell.name, spell });
  }

  // Every other spell in the book: prepared as the plan says, and unprepared when the
  // plan leaves it out, so the Spells tab ends up showing the loadout and nothing else.
  for (const spell of actor.itemTypes.spell) {
    if (spell.system?.spellbook !== bookId || copyOf(spell) || spell.system.atWill) continue;
    const want = granted.get(spell.id);
    countChange(updateOf(spell), spell, want?.count ?? 0, hybrid);
    if (!want) {
      markClear(updateOf(spell), spell);
      continue;
    }
    markChange(updateOf(spell), spell, want);
    prepared.push({ special: spell.system.domain === true, name: spell.name, spell });
  }

  const toCreate = [];
  const missing = [];
  for (const [key, want] of wanted) {
    if (kept.has(key)) continue;
    const doc = await fromUuid(want.uuid).catch(() => null);
    if (doc?.documentName !== "Item" || doc.type !== "spell") {
      missing.push(want.uuid);
      continue;
    }
    const data = await copyData(doc, want, bookId, tag, metamagics);
    toCreate.push(data);
    prepared.push({ special: want.slot === SLOT.special, name: doc.name, data });
  }

  // Special-slot spells lead, then the rest, each by name. §13.11
  prepared.sort((a, b) => Number(b.special) - Number(a.special) || a.name.localeCompare(b.name));
  prepared.forEach((entry, index) => {
    const sort = (index + 1) * 10;
    if (entry.data) entry.data.sort = sort;
    else if (entry.spell.sort !== sort) updateOf(entry.spell).sort = sort;
  });

  // Entries kept for substitution and flexible slots are settled alongside, and are
  // not part of the loadout or its counts.
  const prepares = cfg.mode === "prepared";
  const subs = await substitutionChanges(actor, bookId, new Set([...wanted.values()].map((want) => want.uuid)));
  const flex = prepares ? flexChanges(actor, bookId) : { toDelete: [], toUpdate: [], toCreate: [] };
  const extra = {
    deleted: subs.toDelete.length + flex.toDelete.length,
    updated: flex.toUpdate.length,
    created: subs.toCreate.length + flex.toCreate.length,
  };
  toDelete.push(...subs.toDelete, ...flex.toDelete);
  toCreate.push(...subs.toCreate, ...flex.toCreate);

  const toUpdate = [...updates.values()].filter((update) => Object.keys(update).length > 1);
  toUpdate.push(...flex.toUpdate);

  if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
  if (toUpdate.length) await actor.updateEmbeddedDocuments("Item", toUpdate);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

  Hooks.callAll(HOOK_PREPARED, actor, bookId, plan ?? []);
  return {
    created: toCreate.length - extra.created,
    updated: toUpdate.length - extra.updated,
    deleted: toDelete.length - extra.deleted,
    missing,
  };
}
