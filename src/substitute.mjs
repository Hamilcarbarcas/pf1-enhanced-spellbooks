/**
 * Substitution: casting a spell by giving up a different prepared one, as a cleric
 * does for cure spells and a druid for summon nature's ally. DESIGN.md §15.
 */

import { LOG, MODULE_ID } from "./const.mjs";
import { bookData, getSlots, listTag } from "./books.mjs";
import { getBookList, getEntries, resolveEntries } from "./sources.mjs";
import { SUB_KIND, getGroups, getSubs, groupOfGranted, subMatches, traitsOf } from "./rules.mjs";

const { DialogV2 } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));
const copyOf = (item) => item?.flags?.[MODULE_ID]?.copy ?? null;

/** The substitution rules a book casts by. Only a book that fills slots has any. */
export function activeSubs(actor, bookId) {
  if ((bookData(actor, bookId)?.spellPreparationMode || "prepared") !== "prepared") return [];
  return getSubs(actor, bookId);
}

/** What to say on the card of a spell being cast by substitution, by the spell's uuid. */
const pendingNotes = new Map();

/**
 * Adds the line about what was given up to the cast spell's own footnotes. The system
 * gathers those just before this hook and renders them after. §15.2
 */
export function registerSubstitutionNotes() {
  Hooks.on("pf1PreActionUse", (actionUse) => {
    const text = pendingNotes.get(actionUse?.item?.uuid);
    if (!text) return;
    const data = actionUse.shared?.templateData;
    if (data) (data.footnotes ??= []).push({ text });
  });
}

/** A spell item as the rules see it. */
function describe(item) {
  return {
    ...traitsOf(item),
    name: item.name,
    uuid: copyOf(item)?.uuid ?? item._stats?.compendiumSource ?? null,
    // A copy in a special slot is not one of the actor's own domain spells.
    marked: item.system?.domain === true && !copyOf(item),
  };
}

/** The key of the flexible group a spell item holds a slot for, or null. §17 */
export function flexKey(item) {
  return copyOf(item)?.flex ?? null;
}

/** Whether a spell item may be cast by substitution. */
export function isSubstitutable(item, subs) {
  if (!subs.length || item?.type !== "spell" || flexKey(item)) return false;
  const spell = describe(item);
  return subs.some((sub) => subMatches(sub, spell));
}

/**
 * The spells from the book's list, and those a rule names outright, that need an
 * entry on the Spells tab to be cast from. Limited to levels the book can cast.
 *
 * @returns {Promise<string[]>} Source uuids.
 */
export async function substitutionSpells(actor, bookId) {
  const subs = activeSubs(actor, bookId).filter((sub) => sub.kind !== SUB_KIND.domain);
  if (!subs.length) return [];

  const list = getBookList(actor, bookId);
  const named = subs.flatMap((sub) =>
    sub.kind === SUB_KIND.spells ? sub.spells.map((spell) => ({ id: null, uuid: spell.uuid, name: spell.name })) : []
  );
  const resolved = await resolveEntries([...(list.target ? getEntries(list.target) : []), ...named], listTag(actor, bookId));
  const castable = new Set(
    getSlots(actor, bookId)
      .filter((slot) => slot.castable)
      .map((slot) => slot.level)
  );

  const uuids = new Set();
  for (const entry of resolved) {
    if (entry.missing || !castable.has(entry.level)) continue;
    if (subs.some((sub) => subMatches(sub, entry))) uuids.add(entry.uuid);
  }
  return [...uuids];
}

/**
 * The prepared spells that may be given up to cast `target`: in the same book, of its
 * level or higher, never an orison, with a use left, and not a marked spell unless a
 * rule covering the target allows it.
 */
export function sacrificeOptions(actor, bookId, target, subs = activeSubs(actor, bookId)) {
  const spell = describe(target);
  const allowMarked = subs.some((sub) => sub.sacrificeDomain && subMatches(sub, spell));
  const floor = Math.max(1, target.system.level ?? 0);
  return actor.itemTypes.spell
    .filter((item) => {
      if (item.id === target.id || item.system.spellbook !== bookId || item.system.atWill) return false;
      // A flexible slot is not a prepared spell.
      if (flexKey(item)) return false;
      if ((item.system.level ?? 0) < floor) return false;
      if ((item.system.preparation?.value ?? 0) <= 0) return false;
      return allowMarked || item.system.domain !== true;
    })
    .sort((a, b) => a.system.level - b.system.level || a.name.localeCompare(b.name));
}

/**
 * Ask for one spell from a list. Resolves to the item, or null if the cast is called off.
 * The number on each row is its uses left, when `uses` is set.
 */
async function chooseSpell(options, { title, body, uses = true }) {
  const rows = options
    .map((item, index) => {
      const level = game.i18n.localize(pf1.config.spellLevels?.[item.system.level] ?? "");
      const left = item.system.preparation?.value ?? 0;
      return `<label class="pfesb-sacrifice-row">
        <input type="radio" name="sacrifice" value="${esc(item.id)}"${index === 0 ? " checked" : ""}>
        <img src="${esc(item.img)}" alt="">
        <span class="pfesb-sacrifice-name">${esc(item.name)}</span>
        <span class="pfesb-sacrifice-level">${esc(level)}</span>
        ${uses ? `<span class="pfesb-sacrifice-left">${left}</span>` : ""}
      </label>`;
    })
    .join("");

  const id = await DialogV2.prompt({
    classes: ["pfesb-sacrifice"],
    window: { title },
    content: `<p>${esc(body)}</p><div class="pfesb-sacrifice-list">${rows}</div>`,
    ok: { label: "PF1ESB.Sub.Confirm", callback: (event, button) => button.form.elements.sacrifice.value },
    rejectClose: false,
  });
  return options.find((item) => item.id === id) ?? null;
}

/**
 * Cast a spell by giving up a prepared one. The choice is made first, and nothing is
 * spent unless the cast itself goes through.
 */
export async function castBySubstitution(actor, bookId, target) {
  const options = sacrificeOptions(actor, bookId, target);
  if (!options.length) return void ui.notifications.warn(t("PF1ESB.Sub.None", { name: target.name }));

  const sacrificed = await chooseSpell(options, {
    title: t("PF1ESB.Sub.Title", { name: target.name }),
    body: t("PF1ESB.Sub.Body", { name: target.name }),
  });
  if (!sacrificed) return;

  pendingNotes.set(target.uuid, t("PF1ESB.Sub.Footnote", { given: esc(sacrificed.name) }));
  try {
    // Free of its own slot: the spell given up pays for it.
    const result = await target.use({ cost: 0 });
    if (!result || result.err || result.reject) return;

    const left = sacrificed.system.preparation?.value ?? 0;
    await sacrificed.update({ "system.preparation.value": Math.max(0, left - 1) });
  } catch (err) {
    console.error(LOG, "casting by substitution failed", err);
  } finally {
    pendingNotes.delete(target.uuid);
  }
}

/**
 * The spells that can be cast from a flexible slot: the marked spells on the actor that
 * its group claims, of the slot's level or lower. §17
 */
export function flexOptions(actor, bookId, holder) {
  const key = flexKey(holder);
  const groups = getGroups(actor, bookId);
  const level = holder.system.level ?? 0;
  return actor.itemTypes.spell
    .filter((item) => {
      if (item.system.spellbook !== bookId || item.system.domain !== true || copyOf(item)) return false;
      if ((item.system.level ?? 0) > level) return false;
      return groupOfGranted(actor, item, groups) === key;
    })
    .sort((a, b) => b.system.level - a.system.level || a.name.localeCompare(b.name));
}

/**
 * Cast a spell from a flexible slot. The spell is chosen first, and the slot is only
 * spent if the cast goes through.
 */
export async function castFlexible(actor, bookId, holder) {
  if ((holder.system.preparation?.value ?? 0) <= 0) {
    return void ui.notifications.warn(t("PF1ESB.Flex.Spent", { name: holder.name }));
  }
  const options = flexOptions(actor, bookId, holder);
  if (!options.length) return void ui.notifications.warn(t("PF1ESB.Flex.None", { name: holder.name }));

  const spell = await chooseSpell(options, {
    title: holder.name,
    body: t("PF1ESB.Flex.Body", { name: holder.name }),
    uses: false,
  });
  if (!spell) return;

  pendingNotes.set(spell.uuid, t("PF1ESB.Flex.Footnote", { slot: esc(holder.name) }));
  try {
    // Free of its own slot: the flexible slot pays for it.
    const result = await spell.use({ cost: 0 });
    if (!result || result.err || result.reject) return;

    const left = holder.system.preparation?.value ?? 0;
    await holder.update({ "system.preparation.value": Math.max(0, left - 1) });
  } catch (err) {
    console.error(LOG, "casting from a flexible slot failed", err);
  } finally {
    pendingNotes.delete(spell.uuid);
  }
}
