/**
 * Shared by the Spellbook and Prepare windows: labels, grouping, and keeping open
 * windows current. DESIGN.md §13.7.
 */

export const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
export const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

export function levelLabel(level) {
  return game.i18n.localize(pf1.config.spellLevels?.[level] ?? `PF1.SpellLevels.${level}`);
}

/** A DOM-safe window id for one actor's book. */
export function windowId(prefix, actor, bookId) {
  return `${prefix}-${actor.uuid.replaceAll(".", "-")}-${bookId}`;
}

/** Group entries that carry a `level` into `[{ level, entries }]`, lowest level first. */
export function groupByLevel(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.level)) groups.set(entry.level, []);
    groups.get(entry.level).push(entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, list]) => ({ level, entries: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Open the system's spell browser, filtered to a class and optionally a spell level. */
export function browseSpells(tag, level) {
  const browser = pf1.applications.compendiums?.spells;
  if (!browser) return;
  const filters = {};
  if (tag && tag !== "_hd") filters.class = tag;
  if (level !== undefined && level !== null) filters.level = String(level);
  browser._queueFilters(filters);
  browser._render(true, { focus: true });
}

const SUMMARY_TEMPLATE = "systems/pf1/templates/actors/parts/actor-item-summary.hbs";
const SUMMARY = "pfesb-summary";
const EXPANDED = "pfesb-expanded";

/**
 * Show a spell's description and tags under its row, as the system's Spells tab does.
 * The row carries the spell's `data-uuid`. Does nothing if the details are already open.
 */
export async function openSummary(row, { secrets = false } = {}) {
  if (!row || row.querySelector(`.${SUMMARY}`)) return;
  try {
    const doc = await fromUuid(row.dataset.uuid);
    if (!doc) return void ui.notifications.warn("PF1ESB.Source.Missing", { localize: true });
    const rollData = doc.getRollData();
    const chatData = await doc.getChatData({ chatcard: false, rollData });
    const content = await foundry.applications.handlebars.renderTemplate(SUMMARY_TEMPLATE, chatData);
    const summary = document.createElement("div");
    summary.className = SUMMARY;
    summary.innerHTML = await pf1.utils.enrichHTMLUnrolled(content, { rollData, secrets });
    // The window may have been redrawn while the spell loaded.
    if (!row.isConnected || row.querySelector(`.${SUMMARY}`)) return;
    row.append(summary);
    row.classList.add(EXPANDED);
  } catch (err) {
    console.error("PF1 Enhanced Spellbooks |", "showing a spell's details failed", err);
  }
}

/** Close a row's details. Returns whether there were any to close. */
export function closeSummary(row) {
  const summary = row?.querySelector(`.${SUMMARY}`);
  if (!summary) return false;
  summary.remove();
  row.classList.remove(EXPANDED);
  return true;
}

/** Open windows, each with the actor it shows. */
const open = new Map();

export function track(app, actor) {
  open.set(app, { actor, refresh: foundry.utils.debounce(() => app.rendered && app.render(), 50) });
}

export function untrack(app) {
  open.delete(app);
}

function refreshFor(actor) {
  if (!actor) return;
  for (const entry of open.values()) if (entry.actor === actor) entry.refresh();
}

/** Redraw open windows when their actor or its items change. */
export function registerRefresh() {
  Hooks.on("updateActor", (actor) => refreshFor(actor));
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => refreshFor(item.actor));
  }
}
