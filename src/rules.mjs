/**
 * Slot rules: named groups of special slots, and spells that cost extra to prepare.
 * A rule lives on a feature item or, entered by hand, on the actor for one book.
 * DESIGN.md §14.
 */

import { MODULE_ID } from "./const.mjs";
import { bookData, getSlots } from "./books.mjs";

const ENHANCED_LINKS = "pf1-enhanced-links";
/** The enhanced-links flag naming the item that granted a spell. */
const GRANT_PARENT = "grantParent";

const asInt = (value, min = 0) => Math.max(min, Math.floor(Number(value) || 0));
const asKeys = (value) => [...new Set((Array.isArray(value) ? value : []).map((v) => String(v).trim()).filter(Boolean))];

/** A rule with every field present. */
export function normalizeRule(raw, id) {
  return {
    id,
    name: typeof raw?.name === "string" ? raw.name.trim() : "",
    // Fed by marked spells already on the actor, not by matching the book's list.
    granted: raw?.granted === true,
    // The slot is left open and its spell is chosen at casting. Granted rules only. §17
    flexible: raw?.granted === true && raw?.flexible === true,
    schools: asKeys(raw?.schools),
    subschools: asKeys(raw?.subschools),
    descriptors: asKeys(raw?.descriptors),
    // Free text a descriptor must contain, for ones the list above doesn't have.
    descriptorText: typeof raw?.descriptorText === "string" ? raw.descriptorText.trim() : "",
    // Special slots per spell level.
    slots: asInt(raw?.slots),
    // Extra spells per level that must come from this rule. Hybrid books only. §14.2
    known: asInt(raw?.known),
    // Slots a matching spell takes in an ordinary slot.
    cost: asInt(raw?.cost, 1),
  };
}

/** Where a set of rules is stored: a feature item, or the actor for one book. */
export function ruleList(target, bookId = null) {
  if (target?.documentName === "Item") return { doc: target, path: `flags.${MODULE_ID}.rules` };
  if (target?.documentName === "Actor" && bookId) {
    return { doc: target, path: `flags.${MODULE_ID}.books.${bookId}.rules` };
  }
  return null;
}

/** The rules stored in one place. */
export function readRules(list) {
  const stored = list ? foundry.utils.getProperty(list.doc, list.path) ?? {} : {};
  return Object.entries(stored)
    .filter(([, rule]) => rule && typeof rule === "object")
    .map(([id, rule]) => normalizeRule(rule, id));
}

export async function saveRule(list, rule) {
  const { id, ...data } = normalizeRule(rule, rule.id ?? foundry.utils.randomID(8));
  await list.doc.update({ [`${list.path}.${id}`]: data });
  return id;
}

export async function deleteRule(list, id) {
  return list.doc.update({ [`${list.path}.-=${id}`]: null });
}

/**
 * Every rule that applies to a book: those entered by hand for it, and those on the
 * actor's items tied to the book's class. Each gets a `key` unique across the actor
 * and the `item` it came from, if any.
 */
export function getRules(actor, bookId) {
  const out = readRules(ruleList(actor, bookId)).map((rule) => ({ ...rule, key: `actor.${rule.id}`, item: null }));
  const tag = bookData(actor, bookId)?.class;
  if (!tag) return out;
  for (const item of actor.items) {
    if (item.type === "spell" || item.system?.class !== tag) continue;
    for (const rule of readRules(ruleList(item))) out.push({ ...rule, key: `${item.id}.${rule.id}`, item });
  }
  return out;
}

const traitList = (value) => {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value && typeof value === "object") {
    if (value.total instanceof Set) return [...value.total];
    return [...(value.value ?? []), ...(value.custom ?? [])];
  }
  return typeof value === "string" && value ? value.split(/[,;]/) : [];
};
const lower = (list) => list.map((v) => String(v).trim().toLowerCase()).filter(Boolean);

/** A spell's school, subschools, and descriptors. Takes a document, an index entry, or a resolved entry. */
export function traitsOf(spell) {
  const system = spell?.system ?? {};
  return {
    school: String(spell?.school ?? system.school ?? "").toLowerCase(),
    subschools: lower(traitList(spell?.subschools ?? system.subschool)),
    descriptors: lower(traitList(spell?.descriptors ?? system.descriptors)),
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);

/**
 * Whether one of a spell's descriptors is, or names, a wanted one. A descriptor can be
 * a list in one string ("air, earth, fire, or water"), so a whole-word hit inside it
 * counts.
 */
function hasDescriptor(have, wanted) {
  const key = wanted.toLowerCase();
  const word = new RegExp(`\\b${escapeRegExp(key)}\\b`);
  return have.some((descriptor) => descriptor === key || word.test(descriptor));
}

/**
 * Whether a spell fits a set of trait tests: `schools`, `subschools`, `descriptors`, and
 * `descriptorText`. Every kind that is filled in must fit, and one hit within a kind is
 * enough. The two descriptor tests are one kind. A set that names nothing fits nothing.
 */
export function traitsFit(spec, spell) {
  const text = (spec.descriptorText ?? "").toLowerCase();
  const descriptors = spec.descriptors ?? [];
  const wantsDescriptor = descriptors.length > 0 || !!text;
  if (!spec.schools?.length && !spec.subschools?.length && !wantsDescriptor) return false;

  const traits = traitsOf(spell);
  const hit = (wanted, have) => !wanted?.length || wanted.some((w) => have.includes(w.toLowerCase()));
  const descriptorHit =
    !wantsDescriptor ||
    descriptors.some((wanted) => hasDescriptor(traits.descriptors, wanted)) ||
    (!!text && traits.descriptors.some((descriptor) => descriptor.includes(text)));
  return hit(spec.schools, [traits.school]) && hit(spec.subschools, traits.subschools) && descriptorHit;
}

/** Whether a spell fits a slot rule. */
export function matches(rule, spell) {
  return traitsFit(rule, spell);
}

/** What a spell costs in an ordinary slot: the highest cost among the rules it fits. */
export function costOf(rules, spell) {
  let cost = 1;
  for (const rule of rules) if (rule.cost > cost && matches(rule, spell)) cost = rule.cost;
  return cost;
}

/** The item that granted a spell through enhanced links, or null. */
function grantParent(actor, spell) {
  const id = spell?.flags?.[ENHANCED_LINKS]?.[GRANT_PARENT];
  return id ? actor.items.get(id) ?? null : null;
}

/** The fallback group, for marked spells no rule claims. */
export const DEFAULT_GROUP = "default";

/**
 * The groups of special slots a book has. §14.3
 *
 * - One per rule that gives slots (or, on a hybrid book, extra spells).
 * - One fallback for marked spells on the actor that no rule claims, holding whatever
 *   the system's special pool has left.
 *
 * @returns {{key: string, name: string, rule: object|null, granted: boolean, marked: boolean, capacity: number}[]}
 */
export function getGroups(actor, bookId, rules = getRules(actor, bookId)) {
  const hybrid = bookData(actor, bookId)?.spellPreparationMode === "hybrid";
  const groups = [];
  let claimed = 0;
  for (const rule of rules) {
    const capacity = rule.slots + (hybrid ? rule.known : 0);
    if (capacity <= 0) continue;
    claimed += rule.slots;
    groups.push({
      key: rule.key,
      name: rule.name || rule.item?.name || "",
      rule,
      granted: rule.granted,
      // Only slots from the system's special pool mark their spell. §14.2
      marked: rule.slots > 0,
      flexible: rule.flexible && rule.slots > 0,
      capacity,
    });
  }
  const pool = Math.max(0, ...getSlots(actor, bookId).map((slot) => slot.special));
  groups.push({
    key: DEFAULT_GROUP,
    name: "",
    rule: null,
    granted: true,
    marked: true,
    flexible: false,
    capacity: Math.max(0, pool - claimed),
  });
  return groups;
}

/** Ids of the items that granted a marked spell to this actor. */
function grantingItems(actor) {
  const ids = new Set();
  for (const spell of actor.itemTypes?.spell ?? actor.items ?? []) {
    if (spell.system?.domain !== true) continue;
    const id = spell.flags?.[ENHANCED_LINKS]?.[GRANT_PARENT];
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * The group a marked spell on the actor belongs to. §14.3
 *
 * 1. A granted rule on the very item that granted the spell.
 * 2. Else a general granted rule: one entered by hand, or one on a feature that grants
 *    no marked spells of its own. This is the feature that gives the slot while other
 *    features give the spells, as a cleric's Domains does for each domain.
 * 3. Else the fallback.
 */
export function groupOfGranted(actor, spell, groups) {
  const parent = grantParent(actor, spell);
  const granted = groups.filter((group) => group.granted && group.rule);
  const own = parent && granted.find((group) => group.rule.item === parent);
  if (own) return own.key;
  const granting = grantingItems(actor);
  const general = granted.find((group) => !group.rule.item || !granting.has(group.rule.item.id));
  return general?.key ?? DEFAULT_GROUP;
}

/**
 * On a hybrid book, how many spells per level the rules add that the system's own
 * count does not hold: rule slots beyond the book's Domain/School pool, and extra
 * spells. `syncRuleOffsets` writes it into each level's prepared offset, and the
 * Prepare window takes it back out of the ordinary count it shows. §14.7
 */
export function knownBonus(actor, bookId, rules = getRules(actor, bookId)) {
  const book = bookData(actor, bookId);
  if (book?.spellPreparationMode !== "hybrid") return 0;
  // Slots the book's own Domain/School pool covers are counted by the system already.
  const slots = rules.reduce((sum, rule) => sum + rule.slots, 0);
  const pool = Math.max(0, Math.floor(Number(book.domainSlotValue) || 0));
  return Math.max(0, slots - pool) + rules.reduce((sum, rule) => sum + rule.known, 0);
}

/* -------------------------------------------- */
/*  Substitution                                */
/* -------------------------------------------- */

/** What a substitution rule picks its spells by. §15 */
export const SUB_KIND = {
  cure: "cure",
  inflict: "inflict",
  sna: "sna",
  name: "name",
  domain: "domain",
  // By school, subschool, or descriptor.
  traits: "traits",
  spells: "spells",
};

/** Name tests for the built-in kinds, as the rules text gives them. */
const NAME_TEST = {
  [SUB_KIND.cure]: /\bcure\b/i,
  [SUB_KIND.inflict]: /\binflict\b/i,
  [SUB_KIND.sna]: /\bsummon nature.s ally\b/i,
};

/** A substitution rule with every field present. */
export function normalizeSub(raw, id) {
  return {
    id,
    name: typeof raw?.name === "string" ? raw.name.trim() : "",
    kind: Object.values(SUB_KIND).includes(raw?.kind) ? raw.kind : SUB_KIND.cure,
    // For kind "name": text a spell's name must contain.
    text: typeof raw?.text === "string" ? raw.text.trim() : "",
    // For kind "traits".
    schools: asKeys(raw?.schools),
    subschools: asKeys(raw?.subschools),
    descriptors: asKeys(raw?.descriptors),
    descriptorText: typeof raw?.descriptorText === "string" ? raw.descriptorText.trim() : "",
    // For kind "spells": the spells themselves.
    spells: (Array.isArray(raw?.spells) ? raw.spells : [])
      .filter((spell) => spell?.uuid)
      .map((spell) => ({ uuid: String(spell.uuid), name: String(spell.name ?? "") })),
    // Whether a marked spell may be the one given up.
    sacrificeDomain: raw?.sacrificeDomain === true,
  };
}

/** Where a set of substitution rules is stored: a feature item, or the actor for one book. */
export function subList(target, bookId = null) {
  if (target?.documentName === "Item") return { doc: target, path: `flags.${MODULE_ID}.subs` };
  if (target?.documentName === "Actor" && bookId) {
    return { doc: target, path: `flags.${MODULE_ID}.books.${bookId}.subs` };
  }
  return null;
}

export function readSubs(list) {
  const stored = list ? foundry.utils.getProperty(list.doc, list.path) ?? {} : {};
  return Object.entries(stored)
    .filter(([, sub]) => sub && typeof sub === "object")
    .map(([id, sub]) => normalizeSub(sub, id));
}

export async function saveSub(list, sub) {
  const { id, ...data } = normalizeSub(sub, sub.id ?? foundry.utils.randomID(8));
  await list.doc.update({ [`${list.path}.${id}`]: data });
  return id;
}

export async function deleteSub(list, id) {
  return list.doc.update({ [`${list.path}.-=${id}`]: null });
}

/** Every substitution rule that applies to a book, found the way `getRules` finds slot rules. */
export function getSubs(actor, bookId) {
  const out = readSubs(subList(actor, bookId));
  const tag = bookData(actor, bookId)?.class;
  if (!tag) return out;
  for (const item of actor.items) {
    if (item.type === "spell" || item.system?.class !== tag) continue;
    out.push(...readSubs(subList(item)));
  }
  return out;
}

/**
 * Whether a substitution rule covers a spell.
 *
 * @param {object} sub
 * @param {object} spell  Its `name`; its source `uuid`; `marked`, whether it is a domain
 *   or school spell on the actor; and its traits, in any shape `traitsOf` reads.
 */
export function subMatches(sub, spell) {
  const name = String(spell?.name ?? "");
  if (sub.kind in NAME_TEST) return NAME_TEST[sub.kind].test(name);
  if (sub.kind === SUB_KIND.name) return !!sub.text && name.toLowerCase().includes(sub.text.toLowerCase());
  if (sub.kind === SUB_KIND.domain) return spell?.marked === true;
  if (sub.kind === SUB_KIND.traits) return traitsFit(sub, spell);
  return sub.spells.some((own) => (spell?.uuid && own.uuid === spell.uuid) || (!!own.name && own.name === name));
}
