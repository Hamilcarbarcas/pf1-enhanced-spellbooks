/**
 * The system's own rest: when it restores daily uses, the day's checks on borrowed
 * spellbooks are forgotten and the character is offered the Prepare Spells window from
 * a chat card. A rest manager that stages a preparation ahead uses the API instead.
 * DESIGN.md §18.2.
 */

import { LOG, MODULE_ID } from "./const.mjs";
import { bookName, getManagedBooks } from "./books.mjs";
import { resetChecks } from "./borrow.mjs";
import { openPrepare } from "./apps/prepare-window.mjs";

const FLAG = "rest";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * Let an actor's books be prepared once, for a world that prepares only after a rest.
 * The mark is on the actor, so it holds for whoever opens the window, and is spent by
 * the next loadout applied. §25
 */
export async function grantPreparation(actor, bookId = null) {
  const update = {};
  for (const id of bookId ? [bookId] : getManagedBooks(actor)) update[`flags.${MODULE_ID}.books.${id}.ticket`] = true;
  if (Object.keys(update).length) await actor.update(update);
}

/** The card that offers each managed book's Prepare Spells window, shown to the actor's owners. */
async function offerPreparation(actor) {
  const books = getManagedBooks(actor);
  if (!books.length) return;
  await grantPreparation(actor);
  const buttons = books
    .map(
      (bookId) =>
        `<button type="button" data-pfesb-prepare="${esc(bookId)}"><i class="fa-solid fa-list-check" inert></i> ${esc(
          t("PF1ESB.Rest.Prepare", { book: bookName(actor, bookId) })
        )}</button>`
    )
    .join("");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    whisper: game.users.filter((user) => actor.testUserPermission(user, "OWNER")).map((user) => user.id),
    content: `<p>${esc(t("PF1ESB.Rest.Card", { name: actor.name }))}</p><div class="pfesb-rest-card">${buttons}</div>`,
    flags: { [MODULE_ID]: { [FLAG]: { actor: actor.uuid } } },
  });
}

export function registerRest() {
  // Fired on the client that ran the rest, after the system has restored uses, so kept
  // spells are already full and new ones arrive full.
  Hooks.on("pf1ActorRest", (actor, options) => {
    if (!actor?.isOwner || options?.restoreDailyUses !== true) return;
    resetChecks(actor)
      .then(() => offerPreparation(actor))
      .catch((err) => console.error(LOG, "offering spell preparation after a rest failed", err));
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const rest = message.flags?.[MODULE_ID]?.[FLAG];
    if (!rest) return;
    for (const button of html.querySelectorAll("[data-pfesb-prepare]")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const actor = await fromUuid(rest.actor).catch(() => null);
        if (!actor?.isOwner) return void ui.notifications.warn("PF1ESB.Rest.NotOwner", { localize: true });
        openPrepare(actor, button.dataset.pfesbPrepare);
      });
    }
  });
}
