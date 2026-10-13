/**
 * The Spellbook window: what a book's list holds, and where spells are added to it.
 * The list is a spellbook item's, or the favored spells of a book that has its whole
 * class list. DESIGN.md §13.7, §13.9, §13.12.
 */

import { ACCESS, CSS, LOG, TEMPLATES } from "../const.mjs";
import { bookClass, bookData, bookName, getConfig, getSlots, listTag } from "../books.mjs";
import {
  eligibleBooks,
  eligibleSources,
  favoredList,
  forget,
  getEntries,
  getPrimary,
  getSourceConfig,
  getSources,
  isAvailable,
  learn,
  pagesUsed,
  resolveEntries,
  setEntryMark,
  setPrimary,
} from "../sources.mjs";
import { MARKS } from "../prepare.mjs";
import {
  browseSpells,
  closeSummary,
  esc,
  groupByLevel,
  levelLabel,
  openSummary,
  t,
  track,
  untrack,
  windowId,
} from "./shared.mjs";
import {
  CHECK,
  getChecks,
  isBorrowed,
  isOwn,
  knownIndex,
  knownList,
  memoryList,
  resetChecks,
  setCheck,
  writtenIn,
} from "../borrow.mjs";
import { openPrepare } from "./prepare-window.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const M = `${CSS}book`;

const REFUSED = {
  missing: "PF1ESB.Learn.Refused.Missing",
  notSpell: "PF1ESB.Learn.Refused.NotSpell",
  embedded: "PF1ESB.Learn.Refused.Embedded",
  noRoom: "PF1ESB.Learn.Refused.NoRoom",
};

/** How a reader's check on a borrowed spell is drawn. */
const CHECK_VIEW = {
  [CHECK.pass]: { icon: "fa-circle-check", tip: "PF1ESB.Borrow.CheckPass" },
  [CHECK.fail]: { icon: "fa-ban", tip: "PF1ESB.Borrow.CheckFail" },
  none: { icon: "fa-circle", tip: "PF1ESB.Borrow.CheckNone" },
  unknown: { icon: "fa-circle-question", tip: "PF1ESB.Known.UnknownHere" },
};

/** One window per actor and book. */
const windows = new Map();

const isFavored = (actor, bookId) => getConfig(actor, bookId).access === ACCESS.all;

class SpellbookWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [M],
    window: { icon: "fa-solid fa-book-open", resizable: true },
    // Two list columns wide. §13.9
    position: { width: 940, height: 720 },
    actions: {
      prepare: SpellbookWindow.#prepare,
      browse: SpellbookWindow.#browse,
      adopt: SpellbookWindow.#adopt,
      expand: SpellbookWindow.#expand,
      markDefault: SpellbookWindow.#markDefault,
      memory: SpellbookWindow.#memory,
      check: SpellbookWindow.#check,
      resetChecks: SpellbookWindow.#resetChecks,
      view: SpellbookWindow.#view,
      forget: SpellbookWindow.#forget,
      toggleLevel: SpellbookWindow.#toggleLevel,
    },
  };

  static PARTS = {
    body: { template: `${TEMPLATES}/spellbook-window.hbs`, scrollable: [`.${M}-scroll`] },
  };

  #actor;
  #bookId;
  /** A source item to show in place of the book's own, by uuid. */
  #itemUuid = null;
  /** The window edits the book's known spells, and no spellbook. §21.3 */
  #known = false;
  #collapsed = new Set();
  /** Entry ids whose details are open. */
  #expanded = new Set();

  constructor(actor, bookId, { known = false, ...options } = {}) {
    const key = known ? "PF1ESB.Known.WindowTitle" : isFavored(actor, bookId) ? "PF1ESB.Book.FavoredTitle" : "PF1ESB.Book.Title";
    super({
      ...options,
      id: windowId(known ? `${M}-known` : M, actor, bookId),
      window: { title: t(key, { book: bookName(actor, bookId), actor: actor.name }) },
    });
    this.#actor = actor;
    this.#bookId = bookId;
    this.#known = known;
    track(this, actor);
  }

  /** Show one source item, or the book's own with `null`. */
  show(item) {
    this.#itemUuid = item?.uuid ?? null;
  }

  /** The source item on show: the one asked for while it is still there, else the book's own. */
  get #item() {
    const asked = this.#itemUuid && getSources(this.#actor).find((item) => item.uuid === this.#itemUuid);
    return asked || getPrimary(this.#actor, this.#bookId);
  }

  /** The list on show: the known spells, the favored spells, or the source item. */
  get #list() {
    if (this.#known) return knownList(this.#actor, this.#bookId);
    return isFavored(this.#actor, this.#bookId) ? favoredList(this.#actor, this.#bookId) : this.#item;
  }

  async _prepareContext() {
    const actor = this.#actor;
    const bookId = this.#bookId;
    const cfg = getConfig(actor, bookId);
    const editable = actor.isOwner;

    if (!cfg.managed) return { m: M, note: t("PF1ESB.Book.Unmanaged") };

    // A list on the actor, favored or known, is shown the same way: no item behind it.
    const favored = this.#known || cfg.access === ACCESS.all;
    const item = favored ? null : this.#item;
    if (!favored && !item) {
      const sources = eligibleSources(actor, bookId).map((source) => ({
        uuid: source.uuid,
        name: isAvailable(source) ? source.name : t("PF1ESB.Book.NotCarriedOption", { name: source.name }),
      }));
      return {
        m: M,
        editable,
        choose: true,
        sources,
        note: t(sources.length ? "PF1ESB.Book.Choose" : "PF1ESB.Book.NoItems"),
      };
    }

    const resolved = await resolveEntries(getEntries(this.#list), listTag(actor, bookId));
    // Spells the book can prepare with no spellbook at hand. §21.2
    const remembered = new Set(getEntries(memoryList(actor, bookId)).map((entry) => entry.uuid));
    // Someone else's spellbook shows what this reader's checks came to. §21.3
    const borrowed = !!item && isBorrowed(actor, bookId, item);
    const checks = borrowed ? getChecks(item, actor) : {};
    const known = borrowed ? knownIndex(actor, bookId) : null;
    const found = resolved
      .filter((entry) => !entry.missing)
      .map((entry) => {
        // A spell the book doesn't know can't be prepared from here, so it has no check.
        const unknown = !!known && !known.has(entry);
        const check = unknown ? "unknown" : checks[entry.id] ?? null;
        const view = CHECK_VIEW[check ?? "none"];
        // A known spell still written in an own spellbook can't be taken off the list.
        const written = this.#known ? writtenIn(actor, bookId, entry) : null;
        return {
          ...entry,
          written: !!written,
          writtenTip: written ? t("PF1ESB.Known.Written", { book: written.name }) : "",
          memory: remembered.has(entry.uuid),
          check: check ?? "none",
          unknown,
          failed: check === CHECK.fail,
          checkIcon: view.icon,
          checkTip:
            game.user.isGM && (check === CHECK.pass || check === CHECK.fail)
              ? `${t(view.tip)} ${t("PF1ESB.Borrow.GmFlip")}`
              : view.tip,
        };
      });
    const groups = new Map(groupByLevel(found).map((group) => [group.level, group.entries]));

    // A heading for every level the list can hold, empty or not: up to the book's
    // highest level, or every level the class can cast.
    const settings = item ? getSourceConfig(item) : null;
    const castable = getSlots(actor, bookId).filter((slot) => slot.castable).map((slot) => slot.level);
    // A list on the actor runs to the highest level its class ever casts.
    const book = bookData(actor, bookId);
    const classTop = { high: 9, med: 6, low: 4 }[book?.casterType] ?? 9;
    const top = Math.max(settings ? settings.maxLevel : classTop, ...groups.keys());
    const levels = [];
    for (let level = 0; level <= top; level++) {
      const found = groups.get(level) ?? [];
      // A class with no cantrips has no level for them.
      if (!found.length && level === 0 && book?.hasCantrips === false) continue;
      // A level the caster can't cast yet is greyed, and its spells flagged. §13.12
      const uncastable = !castable.includes(level);
      levels.push({
        level,
        label: levelLabel(level),
        count: found.length,
        collapsed: this.#collapsed.has(level),
        uncastable,
        entries: uncastable ? found.map((entry) => ({ ...entry, uncastable })) : found,
      });
    }

    const base = {
      m: M,
      editable,
      source: true,
      type: bookClass(actor, bookId)?.name ?? bookName(actor, bookId),
      total: resolved.length,
      canPrepare: true,
      levels,
      missing: resolved.filter((entry) => entry.missing),
    };
    if (this.#known) return { ...base, favored: true, known: true, name: t("PF1ESB.Known.Label"), note: t("PF1ESB.Known.Note") };
    if (favored) return { ...base, favored: true, name: t("PF1ESB.Book.Favored") };

    const primary = getPrimary(actor, bookId);
    const used = pagesUsed(found, settings.pageCost);
    // Only a book's own spells can be held in memory.
    base.canMemory = editable && !borrowed;
    base.borrowed = borrowed;
    base.canReset = borrowed && editable;
    base.owner = settings.owner;
    let warning = "";
    if (!isAvailable(item)) warning = t("PF1ESB.Book.NotCarried", { name: item.name });
    else if (borrowed) warning = t(settings.owner ? "PF1ESB.Borrow.NotYours" : "PF1ESB.Borrow.NotYoursUnnamed", { owner: settings.owner });
    else if (primary && primary !== item) warning = t("PF1ESB.Book.NotOwn", { name: primary.name });

    // With more than one spellbook the class can read, the name is a choice among them.
    const readable = eligibleSources(actor, bookId);
    const tagOf = (source) => {
      if (!isAvailable(source)) return t("PF1ESB.Book.NotCarriedTag");
      if (isBorrowed(actor, bookId, source)) return t("PF1ESB.Book.Borrowed");
      return isOwn(actor, bookId, source) ? t("PF1ESB.Book.Own") : "";
    };
    const optionOf = (source) => {
      const tag = tagOf(source);
      return {
        uuid: source.uuid,
        label: tag ? t("PF1ESB.Book.Option", { name: source.name, tag }) : source.name,
        selected: source === item,
      };
    };

    return {
      ...base,
      bookChoices: readable.length > 1 ? readable.map(optionOf) : null,
      ownTag: tagOf(item),
      name: item.name,
      pages: settings.pages ? t("PF1ESB.Book.PagesOf", { used, total: settings.pages }) : String(used),
      pagesOver: settings.pages > 0 && used > settings.pages,
      warning,
      canAdopt: editable && !primary,
      canPrepare: !!primary,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const body = this.element.querySelector(`.${M}-body`);
    if (!body) return;

    // A GM reverses a check by right-clicking it: passed to failed, failed to passed.
    if (game.user.isGM) {
      for (const icon of body.querySelectorAll(".pfesb-check.pfesb-check-pass, .pfesb-check.pfesb-check-fail")) {
        icon.addEventListener("contextmenu", async (event) => {
          event.preventDefault();
          const item = this.#item;
          const entryId = icon.closest("[data-entry]")?.dataset.entry;
          if (!item || !entryId) return;
          const next = icon.classList.contains(`${CSS}check-pass`) ? CHECK.fail : CHECK.pass;
          await setCheck(item, this.#actor, entryId, next).catch((err) => console.error(LOG, "reversing a check failed", err));
        });
      }
    }

    body.querySelector(`.${M}-pick`)?.addEventListener("change", (event) => {
      this.show(getSources(this.#actor).find((source) => source.uuid === event.currentTarget.value) ?? null);
      this.render();
    });

    body.querySelector(`.${M}-primary`)?.addEventListener("change", (event) => {
      const item = getSources(this.#actor).find((source) => source.uuid === event.currentTarget.value) ?? null;
      setPrimary(this.#actor, this.#bookId, item).catch((err) => console.error(LOG, "choosing a spellbook failed", err));
    });

    if (!context.source) return;

    for (const id of this.#expanded) {
      const row = body.querySelector(`[data-entry="${id}"]`);
      if (row) openSummary(row, { secrets: this.#actor.isOwner });
      else this.#expanded.delete(id);
    }

    if (!context.editable) return;
    body.addEventListener("dragover", (event) => event.preventDefault());
    body.addEventListener("drop", (event) => this.#onDrop(event));
  }

  async #onDrop(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const list = this.#list;
    if (!list || data?.type !== "Item" || !data.uuid) return;

    try {
      const { refused } = await learn(list, data.uuid);
      for (const { reason } of refused) ui.notifications.warn(REFUSED[reason], { localize: true });
    } catch (err) {
      console.error(LOG, "adding a spell failed", err);
    }
  }

  static #expand(event, target) {
    const row = target.closest("[data-entry]");
    const id = row.dataset.entry;
    if (closeSummary(row)) return void this.#expanded.delete(id);
    this.#expanded.add(id);
    openSummary(row, { secrets: this.#actor.isOwner });
  }

  /**
   * Set a borrowed spell's check by hand: a spell that failed or was never checked
   * becomes passed, and a passed one goes back to unchecked. §21.3
   */
  static async #check(event, target) {
    const item = this.#item;
    const row = target.closest("[data-entry]");
    if (!item || !row || row.classList.contains(`${CSS}unknown-row`) || !isBorrowed(this.#actor, this.#bookId, item)) return;
    const now = getChecks(item, this.#actor)[row.dataset.entry] ?? null;
    await setCheck(item, this.#actor, row.dataset.entry, now === CHECK.pass ? null : CHECK.pass);
  }

  /** Forget this reader's checks on the spellbook, passed and failed alike. */
  static async #resetChecks() {
    const item = this.#item;
    if (!item) return;
    await resetChecks(this.#actor, item);
    ui.notifications.info("PF1ESB.Borrow.ResetDone", { localize: true });
  }

  /** Put a spell of the book's own spellbook in memory, or take it out. §21.2 */
  static async #memory(event, target) {
    const row = target.closest("[data-uuid]");
    if (!row) return;
    const list = memoryList(this.#actor, this.#bookId);
    const held = getEntries(list).find((entry) => entry.uuid === row.dataset.uuid);
    if (held) await forget(list, held.id);
    else await learn(list, row.dataset.uuid);
  }

  /** Toggle the mark a spell takes when it is added to a loadout. §13.11 */
  static async #markDefault(event, target) {
    const list = this.#list;
    const row = target.closest("[data-entry]");
    const mark = target.dataset.mark;
    if (!list || !row || !(mark in MARKS)) return;
    await setEntryMark(list, row.dataset.entry, mark, !target.classList.contains(`${CSS}on`));
  }

  static #prepare() {
    openPrepare(this.#actor, this.#bookId);
  }

  /** The system's spell browser, filtered to this book's class and, from a level header, that level. */
  static #browse(event, target) {
    const item = this.#known || isFavored(this.#actor, this.#bookId) ? null : this.#item;
    const tag = (item && getSourceConfig(item).class) || listTag(this.#actor, this.#bookId);
    browseSpells(tag, target.closest("[data-level]")?.dataset.level);
  }

  /** Make the item on show this book's own. */
  static async #adopt() {
    const item = this.#item;
    if (item) await setPrimary(this.#actor, this.#bookId, item);
  }

  static async #view(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid).catch(() => null);
    if (doc) doc.sheet.render(true);
    else ui.notifications.warn("PF1ESB.Source.Missing", { localize: true });
  }

  static async #forget(event, target) {
    const row = target.closest("[data-entry]");
    const list = this.#list;
    if (!row || !list) return;

    // Only a spell that is in none of the class's own spellbooks can stop being known:
    // one that is would be known again at once. §21.3
    if (this.#known) {
      const written = writtenIn(this.#actor, this.#bookId, { uuid: row.dataset.uuid, name: row.dataset.name });
      if (written) {
        return void ui.notifications.warn(t("PF1ESB.Known.StillWritten", { spell: row.dataset.name, book: written.name }));
      }
    }

    const from = this.#known
      ? t("PF1ESB.Known.Label")
      : isFavored(this.#actor, this.#bookId)
        ? t("PF1ESB.Book.Favored")
        : this.#item?.name;
    const confirmed = await DialogV2.confirm({
      window: { title: "PF1ESB.Book.ForgetTitle" },
      content: `<p>${t("PF1ESB.Book.ForgetBody", { spell: esc(row.dataset.name), book: esc(from) })}</p>`,
    });
    if (confirmed) await forget(list, row.dataset.entry);
  }

  static #toggleLevel(event, target) {
    const section = target.closest(`.${CSS}level`);
    const level = Number(section.dataset.level);
    if (!this.#collapsed.delete(level)) this.#collapsed.add(level);
    section.classList.toggle(`${CSS}collapsed`);
  }

  _onClose(options) {
    super._onClose(options);
    untrack(this);
    windows.delete(`${this.#actor.uuid}:${this.#bookId}${this.#known ? ":known" : ""}`);
  }
}

/**
 * Open the Spellbook window for one book, or bring it forward.
 *
 * @param {Actor} actor
 * @param {string} bookId
 * @param {Item} [item]  A source item to show in place of the book's own.
 */
export function openSpellbook(actor, bookId, item = null) {
  if (!actor || !bookId) return null;
  const key = `${actor.uuid}:${bookId}`;
  let app = windows.get(key);
  if (!app) {
    app = new SpellbookWindow(actor, bookId);
    windows.set(key, app);
  }
  app.show(item);
  app.render({ force: true }).catch((err) => console.error(LOG, "the Spellbook window failed to open", err));
  return app;
}

/** Open the list of spells a book knows, for editing by hand. §21.3 */
export function openKnown(actor, bookId) {
  if (!actor || !bookId) return null;
  const key = `${actor.uuid}:${bookId}:known`;
  let app = windows.get(key);
  if (!app) {
    app = new SpellbookWindow(actor, bookId, { known: true });
    windows.set(key, app);
  }
  app.render({ force: true }).catch((err) => console.error(LOG, "the Known Spells window failed to open", err));
  return app;
}

/** Open a spellbook item for a class that can use it, asking which when several can. */
export async function openFromItem(item) {
  const actor = item?.actor;
  if (!actor) return null;

  const books = eligibleBooks(actor, item);
  if (!books.length) return void ui.notifications.warn("PF1ESB.Book.NoEligible", { localize: true });
  if (books.length === 1) return openSpellbook(actor, books[0], item);

  const bookId = await DialogV2.wait({
    window: { title: "PF1ESB.Book.WhichTitle" },
    content: `<p>${esc(t("PF1ESB.Book.WhichBody", { name: item.name }))}</p>`,
    buttons: books.map((id) => ({ action: id, label: bookName(actor, id) })),
    rejectClose: false,
  });
  return bookId ? openSpellbook(actor, bookId, item) : null;
}
