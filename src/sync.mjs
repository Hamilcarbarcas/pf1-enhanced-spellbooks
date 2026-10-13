/**
 * Keeps the Spells tab's substitution entries in step when a rule or a spell list
 * changes between preparations. DESIGN.md §15.4.
 */

import { LOG, MODULE_ID } from "./const.mjs";
import { getManagedBooks } from "./books.mjs";
import { syncSubstitutions } from "./prepare.mjs";
import { knownBonus } from "./rules.mjs";

/** One pending pass per actor. */
const pending = new Map();

/** Settle every managed book of an actor, once things have stopped changing. */
function queue(actor) {
  if (!actor?.isOwner || pending.has(actor.uuid)) return;
  pending.set(
    actor.uuid,
    setTimeout(async () => {
      pending.delete(actor.uuid);
      try {
        for (const bookId of getManagedBooks(actor)) await syncSubstitutions(actor, bookId);
      } catch (err) {
        console.error(LOG, "updating substitution entries failed", err);
      }
    }, 250)
  );
}

const touchesModule = (changed) => foundry.utils.hasProperty(changed ?? {}, `flags.${MODULE_ID}`);

/**
 * Runs on the client that made the change only, so one edit makes one pass. Rules and
 * lists live in this module's flags, on the actor and on its items.
 */
export function registerSubstitutionSync() {
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if (userId === game.user.id && touchesModule(changed)) queue(actor);
  });
  Hooks.on("updateItem", (item, changed, options, userId) => {
    // A prepared copy's own flags change with every preparation, which settles itself.
    if (userId !== game.user.id || item.type === "spell" || !item.actor) return;
    if (touchesModule(changed) || foundry.utils.hasProperty(changed ?? {}, "system.items")) queue(item.actor);
  });
}

/* -------------------------------------------- */
/*  The system's count of spells per level       */
/* -------------------------------------------- */

// The addend this module keeps in a level's prepared offset. §14.7
const TERM = "Spell rules";
const TERM_RE = /^\d+\[Spell rules\]$/;

/** Top-level `+` addends of a formula. A lone "0" counts as empty. */
function addends(formula) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(formula ?? "")) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "+" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s && s !== "0");
}

/**
 * Keep each level's prepared offset in step with what a hybrid book's rules add, so
 * the system's own count on the Spells tab agrees with the Prepare window. One labeled
 * addend, rewritten from the rules every time; anything else in the formula stays.
 * A book that needs none loses the addend it had. §14.7
 */
export async function syncRuleOffsets(actor) {
  if (!actor?.isOwner) return false;
  const books = actor._source?.system?.attributes?.spells?.spellbooks ?? {};
  const managed = new Set(getManagedBooks(actor));
  const update = {};
  for (const [bookId, book] of Object.entries(books)) {
    const n = managed.has(bookId) ? knownBonus(actor, bookId) : 0;
    for (let level = 1; level < 10; level++) {
      const stored = book?.spells?.[`spell${level}`]?.preparedOffsetFormula ?? "";
      const terms = addends(stored);
      const others = terms.filter((term) => !TERM_RE.test(term));
      if (!n && others.length === terms.length) continue;
      const next = [...others, ...(n ? [`${n}[${TERM}]`] : [])].join(" + ");
      if (next !== terms.join(" + ")) {
        update[`system.attributes.spells.spellbooks.${bookId}.spells.spell${level}.preparedOffsetFormula`] = next;
      }
    }
  }
  if (!Object.keys(update).length) return false;
  await actor.update(update);
  return true;
}

const offsetsPending = new Map();

function queueOffsets(actor) {
  if (!actor?.isOwner || offsetsPending.has(actor.uuid)) return;
  offsetsPending.set(
    actor.uuid,
    setTimeout(() => {
      offsetsPending.delete(actor.uuid);
      syncRuleOffsets(actor).catch((err) => console.error(LOG, "updating the spells per level failed", err));
    }, 250)
  );
}

/**
 * Rules live on the actor and on its features, and the pool on the book, so any of
 * those changing settles the offsets again, on the client that made the change. An
 * actor sheet being drawn catches up actors no change has reached yet.
 */
export function registerOffsetSync() {
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    if (userId !== game.user.id) return;
    if (touchesModule(changed) || foundry.utils.hasProperty(changed ?? {}, "system.attributes.spells")) queueOffsets(actor);
  });
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item, ...rest) => {
      const userId = rest.at(-1);
      if (userId !== game.user.id || item.type === "spell" || !item.actor) return;
      queueOffsets(item.actor);
    });
  }
  Hooks.on("renderActorSheetPF", (app) => queueOffsets(app.actor));
}
