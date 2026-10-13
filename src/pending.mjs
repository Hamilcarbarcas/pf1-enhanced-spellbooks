/**
 * A preparation chosen now and applied later, for a rest that is still running.
 * DESIGN.md §18.
 */

import { LOG, MODULE_ID } from "./const.mjs";
import { bookOverride, getManagedBooks, savePrevious } from "./books.mjs";
import { getBookList, getEntries, learn } from "./sources.mjs";
import { setPreparation } from "./prepare.mjs";
import { resolveBorrowed } from "./borrow.mjs";

/** Fired on the choosing client when a preparation is set aside: `(actor, bookId, plan)`. */
export const HOOK_STAGED = `${MODULE_ID}.staged`;

/** The preparation waiting to be applied to a book, as plan lines, or null. */
export function getPending(actor, bookId) {
  const plan = bookOverride(actor, bookId).pending?.plan;
  return Array.isArray(plan) ? plan : null;
}

/** The managed books of an actor that have a preparation waiting. */
export function pendingBooks(actor) {
  return getManagedBooks(actor).filter((bookId) => getPending(actor, bookId));
}

/** Set a preparation aside for later. It replaces one already waiting. */
export async function setPending(actor, bookId, plan) {
  await actor.update({ [`flags.${MODULE_ID}.books.${bookId}.pending`]: { plan: plan ?? [] } });
  Hooks.callAll(HOOK_STAGED, actor, bookId, plan ?? []);
}

/** Drop the preparation waiting for a book, if any. */
export async function clearPending(actor, bookId) {
  if (!bookOverride(actor, bookId).pending) return;
  return actor.update({ [`flags.${MODULE_ID}.books.${bookId}.-=pending`]: null });
}

/**
 * What follows any loadout once it is on the actor: it becomes Previous, and a book
 * that asked to has the spells prepared from outside its favored list added to it.
 */
export async function afterApply(actor, bookId, plan) {
  await savePrevious(actor, bookId, plan);
  // The rest's offer to prepare this book is used up. §25
  if (bookOverride(actor, bookId).ticket) await actor.update({ [`flags.${MODULE_ID}.books.${bookId}.-=ticket`]: null });
  if (bookOverride(actor, bookId).autoFavor !== true) return;
  const list = getBookList(actor, bookId);
  if (list.kind !== "favored") return;
  const known = new Set(getEntries(list.target).map((entry) => entry.uuid));
  const uuids = plan.filter((line) => line.uuid && !known.has(line.uuid)).map((line) => line.uuid);
  if (uuids.length) await learn(list.target, uuids);
}

/**
 * Apply the preparation that is waiting, for one book or for every managed book that
 * has one. Meant to run just before the rest restores uses, so kept spells are topped
 * up by the rest and new ones arrive full. §18
 *
 * @param {Actor} actor
 * @param {string} [bookId]
 * @returns {Promise<Record<string, object>>} `setPreparation`'s result per book applied.
 */
export async function applyPending(actor, bookId = null) {
  const results = {};
  for (const id of bookId ? [bookId] : pendingBooks(actor)) {
    const plan = getPending(actor, id);
    if (!plan) continue;
    // One book failing leaves its choice waiting and doesn't hold up the others.
    try {
      // Borrowed spells not yet checked are checked now. §21.3
      const borrowed = await resolveBorrowed(actor, id, plan);
      if (borrowed.cancelled) {
        results[id] = { cancelled: true };
        continue;
      }
      const kept = plan.filter((line) => !line.uuid || !borrowed.dropped.has(line.uuid));
      results[id] = await setPreparation(actor, id, kept);
      await afterApply(actor, id, kept);
      await clearPending(actor, id);
    } catch (err) {
      console.error(LOG, `applying the preparation set aside for "${id}" failed`, err);
      results[id] = { error: err };
    }
  }
  return results;
}
