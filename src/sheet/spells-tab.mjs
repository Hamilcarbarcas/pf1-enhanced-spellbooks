/**
 * Actor sheet changes. On the Spells tab of a book that has a Spellbook: the open
 * button, unprepared spells hidden, preparation locked, and two additions to the
 * book's settings. On the inventory: an open button on each spellbook item.
 * DESIGN.md §5.7, §13.1, §13.9, §13.10.
 */

import { ACCESS, CSS, LOG, SOURCE_SUBTYPE } from "../const.mjs";
import { bookData, bookOverride, getConfig, setOverride } from "../books.mjs";
import { eligibleSources, getPrimary, getSources, isAvailable, isSource, setPrimary } from "../sources.mjs";
import { openFromItem, openKnown, openSpellbook } from "../apps/spellbook-window.mjs";
import { openPrepare } from "../apps/prepare-window.mjs";
import { knownIndex } from "../borrow.mjs";
import { openRules } from "../apps/rules-window.mjs";
import { readRules, readSubs, ruleList, subList } from "../rules.mjs";
import { activeSubs, castBySubstitution, castFlexible, flexKey, isSubstitutable } from "../substitute.mjs";
import { castWithMetamagic, getMetamagics } from "../metamagic.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/** Whether nothing of a spell is prepared, by the book's own notion of prepared. */
function isUnprepared(item, mode) {
  if (item.system.atWill) return false;
  const prep = item.system.preparation ?? {};
  // A hybrid book toggles `value`; a prepared one counts `max`, which casting leaves alone.
  return ((mode === "hybrid" ? prep.value : prep.max) ?? 0) <= 0;
}

/** The spellbook item choice, in the book's settings panel. */
function addPrimaryChoice(app, tab, bookId) {
  const actor = app.actor;
  const panel = tab.querySelector(".spellbook-configuration .spellbook-info");
  if (!panel || panel.querySelector(`.${CSS}primary`)) return;

  const primary = getPrimary(actor, bookId);
  const options = eligibleSources(actor, bookId)
    .map((item) => {
      const name = isAvailable(item) ? item.name : t("PF1ESB.Book.NotCarriedOption", { name: item.name });
      return `<option value="${esc(item.uuid)}"${item === primary ? " selected" : ""}>${esc(name)}</option>`;
    })
    .join("");

  const group = document.createElement("div");
  group.className = `form-group ${CSS}primary`;
  group.innerHTML = `
    <h3>${esc(t("PF1ESB.Book.Item"))}</h3>
    <div class="form-fields">
      <select${actor.isOwner ? "" : " disabled"}>
        <option value="">${esc(t("PF1ESB.Access.None"))}</option>${options}
      </select>
    </div>`;
  (panel.querySelector(".alt-name") ?? panel.lastElementChild)?.after(group);

  // No `name`, so the sheet's own submit skips it.
  group.querySelector("select").addEventListener("change", (event) => {
    event.stopPropagation();
    const item = getSources(actor).find((source) => source.uuid === event.currentTarget.value) ?? null;
    setPrimary(actor, bookId, item).catch((err) => console.error(LOG, "choosing a spellbook failed", err));
  });
}

/** The button that opens the slot rules entered by hand for this book. §14.4 */
function addRulesButton(app, tab, bookId) {
  const actor = app.actor;
  const panel = tab.querySelector(".spellbook-configuration .spellbook-info");
  if (!panel || panel.querySelector(`.${CSS}rules-open`)) return;

  const count = readRules(ruleList(actor, bookId)).length + readSubs(subList(actor, bookId)).length;
  const group = document.createElement("div");
  group.className = `form-group ${CSS}rules-open`;
  group.innerHTML = `
    <h3>${esc(t("PF1ESB.Rules.Label"))}</h3>
    <div class="form-fields">
      <button type="button"><i class="fa-solid fa-layer-group" inert></i> ${esc(t("PF1ESB.Rules.Edit", { count }))}</button>
    </div>`;
  (panel.querySelector(`.${CSS}primary`) ?? panel.querySelector(".alt-name") ?? panel.lastElementChild)?.after(group);

  group.querySelector("button").addEventListener("click", (event) => {
    event.preventDefault();
    openRules(actor, bookId);
  });
}

/** The button that opens the book's known spells, for editing by hand. §21.3 */
function addKnownButton(app, tab, bookId) {
  const actor = app.actor;
  const panel = tab.querySelector(".spellbook-configuration .spellbook-info");
  if (!panel || panel.querySelector(`.${CSS}known-open`)) return;

  const group = document.createElement("div");
  group.className = `form-group ${CSS}known-open`;
  group.innerHTML = `
    <h3>${esc(t("PF1ESB.Known.Label"))}</h3>
    <div class="form-fields">
      <button type="button"><i class="fa-solid fa-graduation-cap" inert></i> ${esc(t("PF1ESB.Known.Edit", { count: knownIndex(actor, bookId).size }))}</button>
    </div>`;
  (panel.querySelector(`.${CSS}rules-open`) ?? panel.lastElementChild)?.after(group);

  group.querySelector("button").addEventListener("click", (event) => {
    event.preventDefault();
    openKnown(actor, bookId);
  });
}

/** A checkbox of this module's, added to the book's own list of them. Saved to the book's settings. */
function addCheckbox(app, tab, bookId, { key, label, checked }) {
  const actor = app.actor;
  const list = tab.querySelector(".spellbook-configuration .spell-settings");
  const marker = `${CSS}setting-${key}`;
  if (!list || list.querySelector(`.${marker}`)) return;

  const el = document.createElement("label");
  el.className = `checkbox ${marker}`;
  el.innerHTML = `<input type="checkbox"${checked ? " checked" : ""}${actor.isOwner ? "" : " disabled"}> ${esc(t(label))}`;
  list.append(el);

  // No `name`, so the sheet's own submit skips it.
  el.querySelector("input").addEventListener("change", (event) => {
    event.stopPropagation();
    setOverride(actor, bookId, key, event.currentTarget.checked);
  });
}

/** The button on a flexible slot that chooses the spell to cast from it. */
function addFlexButton(actor, bookId, row, item) {
  const cell = row.querySelector(".item-actions .item-action") ?? row.querySelector(".item-actions");
  if (!cell || cell.querySelector(`.${CSS}flex-cast`)) return;

  const button = document.createElement("a");
  button.className = `item-control ${CSS}flex-cast`;
  button.dataset.tooltip = "PF1ESB.Flex.Cast";
  button.innerHTML = `<i class="fa-solid fa-wand-sparkles" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    castFlexible(actor, bookId, item);
  });
  cell.append(button);
}

/** The cast-by-substitution button, beside a spell's ordinary use button. */
function addSubstitutionButton(actor, bookId, row, item) {
  const cell = row.querySelector(".item-actions .item-action") ?? row.querySelector(".item-actions");
  if (!cell || cell.querySelector(`.${CSS}sub-cast`)) return;

  const button = document.createElement("a");
  button.className = `item-control ${CSS}sub-cast`;
  button.dataset.tooltip = "PF1ESB.Sub.Cast";
  button.innerHTML = `<i class="fa-solid fa-bolt-lightning" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    castBySubstitution(actor, bookId, item);
  });
  cell.append(button);
}

/**
 * A cast-with-metamagic button on every spell of a book that casts from a pool, whether
 * or not it has a Spellbook. A book that fills slots applies metamagic when preparing. §20.4
 */
function addMetamagicButtons(app, tab) {
  const actor = app.actor;
  const mode = bookData(actor, tab.dataset.tab)?.spellPreparationMode;
  if (mode !== "spontaneous" && mode !== "hybrid") return;
  if (!actor.isOwner || !getMetamagics(actor).length) return;

  for (const row of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(row.dataset.itemId);
    const cell = row.querySelector(".item-actions .item-action") ?? row.querySelector(".item-actions");
    if (item?.type !== "spell" || !cell || cell.querySelector(`.${CSS}meta-cast`)) continue;
    // A flexible slot's stand-in is not a spell to change.
    if (flexKey(item)) continue;

    const button = document.createElement("a");
    button.className = `item-control ${CSS}meta-cast`;
    button.dataset.tooltip = "PF1ESB.Meta.Cast";
    button.innerHTML = `<i class="fa-solid fa-angles-up" inert></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      castWithMetamagic(actor, item);
    });
    cell.append(button);
  }
}

/**
 * A hybrid book's preparations at one level, as the system counts them: every spell
 * with a use left, at its slot cost, against the ordinary preparations plus the
 * Domain/School pool. Null for a level it can't prepare.
 */
function preparedCount(actor, bookId, book, level) {
  const data = book.spells?.[`spell${level}`];
  const base = Number(data?.preparation?.max);
  if (!Number.isFinite(base)) return null;
  const pool = level > 0 ? Math.max(0, Number(data?.domain?.max) || 0) : 0;
  let used = 0;
  for (const spell of actor.itemTypes?.spell ?? []) {
    if (spell.system?.spellbook !== bookId || spell.system.level !== level || spell.system.atWill) continue;
    if ((spell.system.preparation?.value ?? 0) <= 0) continue;
    used += Math.max(1, Number(spell.slotCost ?? spell.system.slotCost) || 1);
  }
  return { used, max: base + pool };
}

/**
 * On a level's heading, how many spells it holds against how many it may: known for a
 * book that knows a set number, prepared for a hybrid book. The system only says so
 * when the two differ. Any such book, with a Spellbook or not. §25
 */
function addKnownCounts(app, tab) {
  const actor = app.actor;
  const bookId = tab.dataset.tab;
  const book = bookData(actor, bookId);
  const mode = book?.spellPreparationMode;
  const hybrid = mode === "hybrid";
  if (!hybrid && mode !== "spontaneous" && mode !== "prestige") return;
  const keys = hybrid
    ? { count: "PF1ESB.Tab.PreparedCount", over: "PF1ESB.Tab.PreparedOver", under: "PF1ESB.Tab.PreparedUnder" }
    : { count: "PF1ESB.Tab.KnownCount", over: "PF1ESB.Tab.KnownOver", under: "PF1ESB.Tab.KnownUnder" };

  for (const header of tab.querySelectorAll("li.spellbook-header[data-level]")) {
    if (header.querySelector(`.${CSS}known-count`)) continue;
    const level = Number(header.dataset.level);
    let used;
    let max;
    if (hybrid) {
      const counted = preparedCount(actor, bookId, book, level);
      if (!counted) continue;
      ({ used, max } = counted);
    } else {
      const known = book.spells?.[`spell${level}`]?.known;
      max = Number(known?.max);
      if (!Number.isFinite(max)) continue;
      used = Number(known.used) || 0;
    }

    const badge = document.createElement("label");
    badge.className = `${CSS}known-count`;
    badge.textContent = t(keys.count, { used, max });
    if (used > max) {
      badge.classList.add(`${CSS}over`);
      badge.dataset.tooltip = t(keys.over, { count: used - max });
    } else if (used < max) {
      badge.dataset.tooltip = t(keys.under, { count: max - used });
    }
    // Beside Little Helper's boxes when they are there; its own count is then hidden.
    const boxes = header.querySelector(".lil-spell-details");
    if (boxes) boxes.prepend(badge);
    else header.querySelector(".item-name")?.append(badge);
  }
}

function decorate(app, tab) {
  const actor = app.actor;
  const bookId = tab.dataset.tab;
  const cfg = getConfig(actor, bookId);
  if (!cfg.managed) return;

  const shown = bookOverride(actor, bookId).showUnprepared === true;
  tab.classList.add(`${CSS}managed`);
  tab.classList.toggle(`${CSS}show-unprepared`, shown);

  if (cfg.mode === "prepared" || cfg.mode === "hybrid") {
    const subs = activeSubs(actor, bookId);
    for (const row of tab.querySelectorAll("li.item[data-item-id]")) {
      const item = actor.items.get(row.dataset.itemId);
      if (item?.type !== "spell") continue;
      // A flexible slot's stand-in: its own button picks what to cast from it. §17
      if (flexKey(item)) {
        row.classList.add(`${CSS}flex`);
        addFlexButton(actor, bookId, row, item);
        continue;
      }
      const unprepared = isUnprepared(item, cfg.mode);
      // A spell that can be cast by substitution stays in view with its own button. §15
      const substitutable = isSubstitutable(item, subs);
      row.classList.toggle(`${CSS}unprepared`, unprepared && !substitutable);
      row.classList.toggle(`${CSS}sub-only`, unprepared && substitutable);
      if (substitutable) addSubstitutionButton(actor, bookId, row, item);
    }
  }

  if (cfg.access === ACCESS.learned) addPrimaryChoice(app, tab, bookId);
  addRulesButton(app, tab, bookId);
  if (cfg.access === ACCESS.learned) addKnownButton(app, tab, bookId);
  addCheckbox(app, tab, bookId, { key: "showUnprepared", label: "PF1ESB.Tab.ShowUnprepared", checked: shown });
  if (cfg.access === ACCESS.all) {
    // Off unless switched on. §13.13
    const auto = bookOverride(actor, bookId).autoFavor === true;
    addCheckbox(app, tab, bookId, { key: "autoFavor", label: "PF1ESB.Tab.AutoFavor", checked: auto });
  }

  if (tab.querySelector(`:scope > .${CSS}bar`)) return;
  const bar = document.createElement("div");
  bar.className = `${CSS}bar`;
  // A book with the whole class list has favored spells in place of a spellbook. §13.12
  const label = cfg.access === ACCESS.all ? "PF1ESB.Tab.OpenFavored" : "PF1ESB.Tab.Open";
  bar.innerHTML = `
    <button type="button" class="${CSS}open">
      <i class="fa-solid fa-book-open" inert></i> ${esc(t(label))}
    </button>
    <button type="button" class="${CSS}prepare">
      <i class="fa-solid fa-list-check" inert></i> ${esc(t("PF1ESB.Book.Prepare"))}
    </button>`;
  tab.prepend(bar);

  bar.querySelector(`.${CSS}prepare`).addEventListener("click", (event) => {
    event.preventDefault();
    openPrepare(actor, bookId);
  });

  bar.querySelector(`.${CSS}open`).addEventListener("click", (event) => {
    event.preventDefault();
    openSpellbook(actor, bookId);
  });
}

/** An Open Spellbook button on each spellbook item's inventory row, where a use button would be. */
function addInventoryButtons(app, root) {
  const actor = app.actor;
  for (const row of root.querySelectorAll(`.item-list[data-list="${SOURCE_SUBTYPE}"] li.item[data-item-id]`)) {
    const cell = row.querySelector(".item-actions .item-action") ?? row.querySelector(".item-actions");
    const item = actor.items.get(row.dataset.itemId);
    if (!cell || !isSource(item) || cell.querySelector(`.${CSS}open-item`)) continue;

    const button = document.createElement("a");
    button.className = `item-control ${CSS}open-item`;
    button.dataset.tooltip = "PF1ESB.Tab.Open";
    button.innerHTML = `<i class="fa-solid fa-book-open" inert></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFromItem(item);
    });
    cell.append(button);
  }
}

export function registerSpellsTab() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    try {
      const root = html?.[0] ?? html;
      if (!root?.querySelectorAll) return;
      for (const tab of root.querySelectorAll(".tab.spellbook-group[data-tab]")) {
        decorate(app, tab);
        addMetamagicButtons(app, tab);
        addKnownCounts(app, tab);
      }
      addInventoryButtons(app, root);
    } catch (err) {
      console.error(LOG, "Spells tab changes failed", err);
    }
  });
}
