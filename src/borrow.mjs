/**
 * Preparing from more than a book's own spellbook: a from-memory list and a list of
 * known spells kept on the actor, and spellbooks that belong to someone else, each
 * spell of which takes a Spellcraft check. DESIGN.md §21.
 */

import { ACCESS, LOG, MODULE_ID } from "./const.mjs";
import { bookData, bookOverride, getConfig, getManagedBooks, listTag } from "./books.mjs";
import {
  eligibleSources,
  getEntries,
  getSourceConfig,
  getSources,
  isAvailable,
  isSource,
  resolveEntries,
  sourceKey,
} from "./sources.mjs";

const { DialogV2 } = foundry.applications.api;

/** Spellcraft, and the check to prepare from a borrowed spellbook: 15 + spell level. */
const SKILL = "spl";
const DC_BASE = 15;
const SOURCE_FLAG = "source";

/** What a check on a borrowed spell came to. Kept on the spellbook until reset. */
export const CHECK = { pass: "pass", fail: "fail" };

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));
const nameKey = (name) => String(name ?? "").trim().toLowerCase();

/** The spells a book can prepare with no spellbook at hand, as a `{ doc, path }` list. */
export function memoryList(actor, bookId) {
  return { doc: actor, path: `flags.${MODULE_ID}.books.${bookId}.memory` };
}

/**
 * Whether a spellbook is a book's own. Its owner is named on the item, by actor id and
 * by name, and either one matching is enough: the id outlives a rename, and the name
 * outlives a copy of the actor taking the original's place. With no owner named, it is
 * the item the book has chosen.
 *
 * Owning it is per class, by the class the spellbook is written for. Written for
 * another of the character's classes, or for no class at all, it is borrowed to this
 * book unless this book chose it. So a wizard/alchemist's wizard spellbook doesn't
 * teach the alchemist its spells. §21.2
 */
export function isOwn(actor, bookId, item) {
  const cfg = getSourceConfig(item);
  const chosen = bookOverride(actor, bookId).primary ?? null;
  const isChosen = !!chosen && sourceKey(item) === chosen;
  const owner = nameKey(cfg.owner);
  if (!owner && !cfg.ownerId) return isChosen;
  const mine = (!!cfg.ownerId && cfg.ownerId === actor?.id) || (!!owner && owner === nameKey(actor?.name));
  if (!mine) return false;
  return isChosen || (!!cfg.class && cfg.class === (bookData(actor, bookId)?.class ?? ""));
}

/**
 * Name a spellbook's owner. The id is kept only when the name is the carrying actor's,
 * so retyping the name for someone else lets go of it.
 */
export async function setOwner(item, name) {
  const owner = String(name ?? "").trim();
  const mine = !!item.actor && nameKey(owner) === nameKey(item.actor.name);
  return item.update({
    [`flags.${MODULE_ID}.${SOURCE_FLAG}.owner`]: owner,
    [`flags.${MODULE_ID}.${SOURCE_FLAG}.ownerId`]: mine ? item.actor.id : "",
  });
}

/**
 * Whether a spellbook is someone else's to a book. An unnamed spellbook is nobody's
 * until the book has chosen its own, so a caster who hasn't picked one yet is not
 * asked for checks on it.
 */
export function isBorrowed(actor, bookId, item) {
  if (isOwn(actor, bookId, item)) return false;
  const cfg = getSourceConfig(item);
  return !!nameKey(cfg.owner) || !!cfg.ownerId || !!bookOverride(actor, bookId).primary;
}

/** The spellbooks a book can prepare from right now, the chosen one leading its own. */
function usableSources(actor, bookId) {
  const chosen = bookOverride(actor, bookId).primary ?? null;
  const usable = eligibleSources(actor, bookId).filter(isAvailable);
  const own = usable.filter((item) => isOwn(actor, bookId, item));
  own.sort((a, b) => Number(sourceKey(b) === chosen) - Number(sourceKey(a) === chosen));
  return { own, borrowed: usable.filter((item) => isBorrowed(actor, bookId, item)) };
}

/**
 * The spells a book knows, kept on the actor so they outlast the spellbook they were
 * written in. A borrowed spellbook serves only these. One list per book, so per class.
 * As a `{ doc, path }` list. §21.3
 */
export function knownList(actor, bookId) {
  return { doc: actor, path: `flags.${MODULE_ID}.books.${bookId}.known` };
}

/** A book's own spellbooks on the actor, carried or not. */
const ownSources = (actor, bookId) => eligibleSources(actor, bookId).filter((item) => isOwn(actor, bookId, item));

/** The book's own spellbook on the actor that holds a spell, or null. */
export function writtenIn(actor, bookId, entry) {
  const name = nameKey(entry?.name);
  return (
    ownSources(actor, bookId).find((item) =>
      getEntries(item).some((other) => other.uuid === entry?.uuid || (!!name && nameKey(other.name) === name))
    ) ?? null
  );
}

/**
 * What a book knows right now: the stored list, and whatever its own spellbooks on the
 * actor hold, so a spell written a moment ago counts before the list catches up.
 *
 * @returns {{has: (entry: {uuid: string, name: string}) => boolean, size: number}}
 */
export function knownIndex(actor, bookId) {
  const uuids = new Set();
  const names = new Set();
  const add = (entry) => {
    uuids.add(entry.uuid);
    if (entry.name) names.add(nameKey(entry.name));
  };
  getEntries(knownList(actor, bookId)).forEach(add);
  for (const item of ownSources(actor, bookId)) getEntries(item).forEach(add);
  // What a feature has put on the actor in this book is known for as long as it is there. §24
  for (const spell of actor?.itemTypes?.spell ?? []) {
    if (spell.system?.spellbook !== bookId || !spell.flags?.["pf1-enhanced-links"]?.grantParent) continue;
    add({ uuid: spell._stats?.compendiumSource ?? spell.uuid, name: spell.name });
  }
  return { has: (entry) => uuids.has(entry.uuid) || names.has(nameKey(entry.name)), size: uuids.size };
}

/**
 * Add to the stored list every spell a book's own spellbooks hold and it lacks. Nothing
 * is ever taken off it here: a spell stays known when its spellbook is lost. §21.3
 *
 * @param {Actor} actor
 * @param {string} [bookId]  One book, or every Learned book of the actor.
 * @returns {Promise<number>} How many spells were added.
 */
export async function syncKnown(actor, bookId = null) {
  if (!actor?.isOwner) return 0;
  const books = (bookId ? [bookId] : getManagedBooks(actor)).filter((id) => getConfig(actor, id).access === ACCESS.learned);
  const update = {};
  let added = 0;
  for (const id of books) {
    const list = knownList(actor, id);
    const have = new Set(getEntries(list).map((entry) => entry.uuid));
    for (const item of ownSources(actor, id)) {
      for (const entry of getEntries(item)) {
        if (have.has(entry.uuid)) continue;
        have.add(entry.uuid);
        // Keyed by the link, so two clients adding the same spell write the same entry.
        const key = entry.uuid.replace(/[^A-Za-z0-9]/g, "_");
        update[`${list.path}.entries.${key}`] = { uuid: entry.uuid, name: entry.name };
        added++;
      }
    }
  }
  if (added) await actor.update(update);
  return added;
}

/** Keep the known lists current as spellbooks gain spells, change hands, or are chosen. */
export function registerKnownSync() {
  const pending = new Map();
  const queue = (actor) => {
    if (!actor?.isOwner) return;
    if (!pending.has(actor)) {
      pending.set(
        actor,
        foundry.utils.debounce(() => {
          pending.delete(actor);
          syncKnown(actor).catch((err) => console.error(LOG, "updating known spells failed", err));
        }, 200)
      );
    }
    pending.get(actor)();
  };
  const watched = ["entries", "owner", "ownerId", "class", "key"];
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId !== game.user.id || !isSource(item)) return;
    const changed = changes?.flags?.[MODULE_ID]?.[SOURCE_FLAG];
    if (changed && watched.some((key) => key in changed)) queue(item.actor);
  });
  Hooks.on("createItem", (item, options, userId) => {
    if (userId === game.user.id && isSource(item)) queue(item.actor);
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    const books = changes?.flags?.[MODULE_ID]?.books;
    if (books && Object.values(books).some((book) => book && "primary" in book)) queue(actor);
  });
}

/** Someone else's spellbooks that a book can prepare from right now. */
export function borrowedSources(actor, bookId) {
  return usableSources(actor, bookId).borrowed;
}

/** A reader's checks on a spellbook's spells, as `{ [entryId]: "pass" | "fail" }`. */
export function getChecks(item, actor) {
  return { ...(item?.flags?.[MODULE_ID]?.[SOURCE_FLAG]?.checks?.[actor?.id] ?? {}) };
}

/** Record a reader's check on one spell of a spellbook, or clear it with null. */
export async function setCheck(item, actor, entryId, value) {
  const path = `flags.${MODULE_ID}.${SOURCE_FLAG}.checks.${actor.id}`;
  if (value === CHECK.pass || value === CHECK.fail) return item.update({ [`${path}.${entryId}`]: value });
  return item.update({ [`${path}.-=${entryId}`]: null });
}

/**
 * Forget a reader's checks, passed and failed alike: on one spellbook, or on every
 * spellbook the actor carries. Nothing else clears them. §21.4
 *
 * @returns {Promise<number>} How many spellbooks were cleared.
 */
export async function resetChecks(actor, item = null) {
  const targets = (item ? [item] : getSources(actor)).filter(
    (source) => isSource(source) && source.flags?.[MODULE_ID]?.[SOURCE_FLAG]?.checks?.[actor.id]
  );
  for (const source of targets) {
    await source.update({ [`flags.${MODULE_ID}.${SOURCE_FLAG}.checks.-=${actor.id}`]: null });
  }
  return targets.length;
}

/**
 * Everything a book can prepare right now: the spells of its own spellbooks, what it
 * holds in memory, and the spells of borrowed spellbooks. A spell found in more than
 * one place is listed once: its own spellbook wins, then memory, then the borrowed
 * spellbook where its check stands best.
 *
 * @returns {Promise<{entries: object[], sources: object[]}>} Entries as `resolveEntries` gives them, plus
 *   `sourceId` (the spellbook item's id, or null for memory alone), `memory`, and for a
 *   borrowed spell `borrowed`, `viaName`, `viaEntry`, `dc`, `check`, and `unknown` (it
 *   is not a spell the book knows, so it can't be prepared from there).
 */
export async function getPool(actor, bookId) {
  const tag = listTag(actor, bookId);
  const { own, borrowed } = usableSources(actor, bookId);
  const out = new Map();
  // A spell linked from two compendiums is the same spell.
  const named = new Map();
  const put = (entry) => {
    out.set(entry.uuid, entry);
    named.set(nameKey(entry.name), entry.uuid);
  };
  const find = (entry) => out.get(entry.uuid) ?? out.get(named.get(nameKey(entry.name)));

  for (const item of own) {
    for (const entry of await resolveEntries(getEntries(item), tag)) {
      if (entry.missing || find(entry)) continue;
      put({ ...entry, sourceId: item.id, memory: false, borrowed: false });
    }
  }

  for (const entry of await resolveEntries(getEntries(memoryList(actor, bookId)), tag)) {
    if (entry.missing) continue;
    const held = find(entry);
    if (held) held.memory = true;
    else put({ ...entry, sourceId: null, memory: true, borrowed: false });
  }

  const known = knownIndex(actor, bookId);
  const rank = (check) => (check === CHECK.pass ? 0 : check === CHECK.fail ? 2 : 1);
  for (const item of borrowed) {
    const checks = getChecks(item, actor);
    for (const entry of await resolveEntries(getEntries(item), tag)) {
      if (entry.missing) continue;
      const held = find(entry);
      const check = checks[entry.id] ?? null;
      if (held && (!held.borrowed || rank(held.check) <= rank(check))) continue;
      if (held) out.delete(held.uuid);
      put({
        ...entry,
        sourceId: item.id,
        memory: false,
        borrowed: true,
        viaName: item.name,
        viaEntry: entry.id,
        dc: DC_BASE + (Number(entry.level) || 0),
        check,
        unknown: !known.has(entry),
      });
    }
  }

  return {
    entries: [...out.values()],
    // The spellbooks the list is drawn from, own ones first.
    sources: [
      ...own.map((item) => ({ id: item.id, name: item.name, own: true })),
      ...borrowed.map((item) => ({ id: item.id, name: item.name, own: false })),
    ],
  };
}

/**
 * One Spellcraft check through the system's own skill roll: its dialog, its dice, and
 * its card. Null when the roll was called off. §21.6, §22
 */
async function rollCheck(actor, entry) {
  // The system writes the flavor after reading its options, so naming the spell in the
  // dialog and on the card has to happen in its hook. Once, for this roll only.
  const hook = Hooks.on("pf1PreActorRollSkill", (roller, options, skillId) => {
    if (roller !== actor || skillId !== SKILL) return;
    Hooks.off("pf1PreActorRollSkill", hook);
    options.flavor = t("PF1ESB.Borrow.Flavor", { check: options.flavor, spell: entry.name, book: entry.viaName });
  });
  // The card is for the actor's owners, GMs among them, whatever roll mode was picked:
  // a preparation can be many checks, and the table doesn't need them. §21.6
  const whisper = Hooks.on("preCreateChatMessage", (message) => {
    if (message.speaker?.actor !== actor.id || message.system?.subject?.skill !== SKILL) return;
    Hooks.off("preCreateChatMessage", whisper);
    message.updateSource({
      whisper: game.users.filter((user) => actor.testUserPermission(user, "OWNER")).map((user) => user.id),
      blind: false,
    });
  });
  try {
    const result = await actor.rollSkill(SKILL, { dc: entry.dc, rollMode: "gmroll" });
    const total = Number(result?.rolls?.[0]?.total);
    return Number.isFinite(total) ? { total, ok: total >= entry.dc } : null;
  } finally {
    Hooks.off("pf1PreActorRollSkill", hook);
    Hooks.off("preCreateChatMessage", whisper);
  }
}

/**
 * Make the check a borrowed spell needs and record it on its spellbook. A spell that
 * has been checked already answers with what is recorded. §21.3
 *
 * @param {Actor} actor
 * @param {object} entry  A borrowed entry from `getPool`.
 * @returns {Promise<"pass"|"fail"|null>} Null when the roll was called off.
 */
export async function checkSpell(actor, entry) {
  if (!entry?.borrowed) return CHECK.pass;
  if (entry.unknown) return null;
  if (entry.check) return entry.check;
  const item = getSources(actor).find((source) => source.id === entry.sourceId);
  if (!item) return null;
  const roll = await rollCheck(actor, entry).catch((err) => {
    console.error(LOG, "a Spellcraft check for a borrowed spell failed to roll", err);
    return null;
  });
  if (!roll) return null;
  const value = roll.ok ? CHECK.pass : CHECK.fail;
  await setCheck(item, actor, entry.viaEntry, value);
  return value;
}

/**
 * Settle a plan's borrowed spells before it is applied. A spell is checked when it is
 * added to a loadout; this catches the ones a loadout carried over from an earlier
 * day. Failed spells, and ones whose roll is called off, are named for leaving out.
 *
 * @param {Actor} actor
 * @param {string} bookId
 * @param {object[]} plan   Plan lines.
 * @param {object} [options]
 * @param {boolean} [options.confirm=false]  Ask before rolling, with a way to call it off.
 * @param {Set<string>} [options.exempt]     Spells left as they are, by uuid.
 * @returns {Promise<{cancelled: boolean, dropped: Set<string>}>}
 */
export async function resolveBorrowed(actor, bookId, plan, { confirm = false, exempt = null } = {}) {
  const dropped = new Set();
  const pool = new Map((await getPool(actor, bookId)).entries.map((entry) => [entry.uuid, entry]));
  const needed = [];
  for (const line of plan ?? []) {
    const entry = line.uuid ? pool.get(line.uuid) : null;
    // A spell with no spellbook here at all is left to the caster. §21.5
    if (!entry?.borrowed || exempt?.has(line.uuid) || needed.includes(entry)) continue;
    if (entry.unknown || entry.check === CHECK.fail) dropped.add(line.uuid);
    else if (entry.check !== CHECK.pass) needed.push(entry);
  }
  if (!needed.length) return { cancelled: false, dropped };

  if (confirm) {
    const items = needed
      .map((entry) => `<li>${esc(entry.name)} <em>(${esc(entry.viaName)}, ${t("PF1ESB.Borrow.DC", { dc: entry.dc })})</em></li>`)
      .join("");
    const go = await DialogV2.confirm({
      window: { title: "PF1ESB.Borrow.ConfirmTitle" },
      content: `<p>${esc(t("PF1ESB.Borrow.ConfirmBody"))}</p><ul>${items}</ul>`,
      yes: { label: "PF1ESB.Borrow.RollAll" },
      no: { label: "PF1ESB.Borrow.Cancel" },
      rejectClose: false,
    });
    if (!go) return { cancelled: true, dropped: new Set() };
  }

  for (const entry of needed) {
    if ((await checkSpell(actor, entry)) !== CHECK.pass) dropped.add(entry.uuid);
  }
  return { cancelled: false, dropped };
}
