/**
 * A spellbook item's sheet: its settings on the Details tab, and a Spells tab that
 * lists what it holds. DESIGN.md §5.2b, §13.9.
 */

import { CSS, LOG } from "../const.mjs";
import {
  PAGE_COST,
  SOURCE_TYPE,
  getEntries,
  getSourceConfig,
  isSource,
  pagesUsed,
  resolveEntries,
  setSourceConfig,
} from "../sources.mjs";
import { setOwner } from "../borrow.mjs";
import { groupByLevel, levelLabel } from "../apps/shared.mjs";
import { openFromItem } from "../apps/spellbook-window.mjs";
import { makeCollapsible } from "../common/sheet/collapse.mjs";

const M = `${CSS}source`;
const TAB = `${CSS}spells`;
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/** The primary tab each open sheet was last on. */
const lastTab = new WeakMap();

/** A class tag as a name: the actor's own class when it has one, else the tag. */
function className(item, tag) {
  if (!tag) return t("PF1ESB.Source.AnyClass");
  return item.actor?.itemTypes?.class?.find((c) => c.system.tag === tag)?.name ?? tag;
}

/** The settings section on the Details tab. */
function injectConfig(app, tab) {
  const item = app.item;
  tab.querySelector(`:scope > .${M}`)?.remove();

  const cfg = getSourceConfig(item);
  const dis = app.isEditable ? "" : " disabled";
  // What the book physically is and costs is the GM's to set. §23
  const gm = app.isEditable && game.user.isGM ? "" : " disabled";
  const isBook = cfg.type === SOURCE_TYPE.book;
  const typeOption = (value, key) =>
    `<option value="${value}"${cfg.type === value ? " selected" : ""}>${esc(t(key))}</option>`;
  const tags = new Set([
    ...Object.keys(pf1.config.classCasterType ?? {}),
    ...(item.actor?.itemTypes?.class ?? []).map((c) => c.system.tag),
  ]);
  const listId = `${M}-classes-${app.appId}`;
  const costOption = (value, key) =>
    `<option value="${value}"${cfg.pageCost === value ? " selected" : ""}>${esc(t(key))}</option>`;

  const section = document.createElement("div");
  section.className = M;
  section.innerHTML = `
    <h3 class="form-header ${M}-header"><i class="fa-solid fa-book-open"></i> ${esc(t("PF1ESB.Source.Title"))}</h3>
    <div class="${M}-body">
      <div class="form-group">
        <label>${esc(t("PF1ESB.Source.Type"))}</label>
        <div class="form-fields">
          <select data-key="type"${dis}>
            ${typeOption(SOURCE_TYPE.book, "PF1ESB.Source.TypeBook")}
            ${typeOption(SOURCE_TYPE.familiar, "PF1ESB.Source.TypeFamiliar")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label data-tooltip="PF1ESB.Source.OwnerHint">${esc(t("PF1ESB.Source.Owner"))}</label>
        <div class="form-fields">
          <input type="text" data-key="owner" value="${esc(cfg.owner)}"${dis}>
          ${
            item.actor
              ? `<button type="button" class="${M}-mine" data-tooltip="PF1ESB.Source.Mine"${dis}><i class="fa-solid fa-user-check" inert></i></button>`
              : ""
          }
        </div>
      </div>
      <div class="form-group">
        <label data-tooltip="PF1ESB.Source.ClassHint">${esc(t("PF1ESB.Source.Class"))}</label>
        <div class="form-fields">
          <input type="text" data-key="class" value="${esc(cfg.class)}" list="${listId}"
            placeholder="${esc(t("PF1ESB.Source.AnyClass"))}"${dis}>
          <datalist id="${listId}">${[...tags].sort().map((tag) => `<option value="${esc(tag)}">`).join("")}</datalist>
        </div>
      </div>
      <div class="form-group">
        <label>${esc(t("PF1ESB.Source.MaxLevel"))}</label>
        <div class="form-fields">
          <input type="number" data-key="maxLevel" value="${cfg.maxLevel}" min="0" max="9" step="1"${dis}>
        </div>
      </div>
      ${
        isBook
          ? `
      <div class="form-group">
        <label data-tooltip="PF1ESB.Source.GmOnly">${esc(t("PF1ESB.Source.Pages"))}</label>
        <div class="form-fields">
          <input type="number" data-key="pages" value="${cfg.pages || ""}" min="0" step="1"
            placeholder="${esc(t("PF1ESB.Source.NoLimit"))}"${gm}>
        </div>
      </div>
      <div class="form-group">
        <label data-tooltip="PF1ESB.Source.GmOnly">${esc(t("PF1ESB.Source.PageCost"))}</label>
        <div class="form-fields">
          <select data-key="pageCost"${gm}>
            ${costOption(PAGE_COST.level, "PF1ESB.Source.CostLevel")}
            ${costOption(PAGE_COST.spell, "PF1ESB.Source.CostSpell")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label data-tooltip="PF1ESB.Source.BaseValueHint">${esc(t("PF1ESB.Source.BaseValue"))}</label>
        <div class="form-fields">
          <input type="number" data-key="baseValue" value="${cfg.baseValue ?? ""}" min="0" step="any"
            placeholder="${Number(item.system?.price) || 0}"${gm}>
        </div>
      </div>`
          : ""
      }
    </div>`;
  tab.append(section);

  // No `name` on these, so the sheet's own submit skips them.
  for (const field of section.querySelectorAll("[data-key]")) {
    field.addEventListener("change", (event) => {
      event.stopPropagation();
      const key = field.dataset.key;
      let value = field.value.trim();
      // The owner is a name and an id, written together.
      if (key === "owner") {
        return void setOwner(item, value).catch((err) => console.error(LOG, "saving a spellbook's owner failed", err));
      }
      if (key === "maxLevel") value = value === "" ? 9 : Math.clamp(Math.floor(Number(value) || 0), 0, 9);
      else if (key === "pages") value = Math.max(0, Math.floor(Number(value) || 0));
      else if (key === "baseValue") value = Math.max(0, Number(value) || 0);
      else if (key === "type") value = value === SOURCE_TYPE.familiar ? SOURCE_TYPE.familiar : SOURCE_TYPE.book;
      setSourceConfig(item, key, value).catch((err) => console.error(LOG, "saving a spellbook setting failed", err));
    });
  }

  section.querySelector(`.${M}-mine`)?.addEventListener("click", (event) => {
    event.preventDefault();
    setOwner(item, item.actor.name).catch((err) => console.error(LOG, "saving a spellbook's owner failed", err));
  });

  makeCollapsible(app, section, {
    key: "source",
    marker: M,
    configured: true,
    badge: getEntries(item).length || "",
    title: t("PF1ESB.Source.Toggle"),
    sortKey: false,
  });
}

/** The read-only Spells tab, after Details. */
async function injectTab(app, root) {
  const item = app.item;
  const nav = root.querySelector("nav.tabs[data-group='primary']");
  const body = root.querySelector("section.primary-body");
  const after = nav?.querySelector('a[data-tab="details"]');
  if (!nav || !body || !after) return;

  const cfg = getSourceConfig(item);
  const resolved = await resolveEntries(getEntries(item), cfg.class);
  // The sheet may have been redrawn or closed while the indexes loaded.
  if (!root.isConnected || nav.querySelector(`a[data-tab="${TAB}"]`)) return;

  const found = resolved.filter((entry) => !entry.missing);
  const missing = resolved.filter((entry) => entry.missing);
  const groups = new Map(groupByLevel(found).map((group) => [group.level, group.entries]));
  const top = Math.max(cfg.maxLevel, ...groups.keys());

  const row = (entry) => `
    <li class="${CSS}row${entry.missing ? ` ${CSS}missing` : ""}">
      ${entry.img ? `<img src="${esc(entry.img)}" alt="">` : ""}
      <a class="${CSS}row-name" data-uuid="${esc(entry.uuid)}">${esc(entry.name)}</a>
    </li>`;
  const level = (label, entries) => `
    <div class="${CSS}level">
      <h4 class="${CSS}level-head">
        <span class="${CSS}level-label">${esc(label)}</span>
        <span class="${CSS}level-count">${entries.length}</span>
      </h4>
      ${entries.length ? `<ol class="${CSS}level-rows">${entries.map(row).join("")}</ol>` : ""}
    </div>`;

  let levels = "";
  for (let n = 0; n <= top; n++) levels += level(levelLabel(n), groups.get(n) ?? []);
  if (missing.length) levels += level(t("PF1ESB.Book.MissingGroup"), missing);

  const used = pagesUsed(found, cfg.pageCost);
  const pages = cfg.pages ? t("PF1ESB.Book.PagesOf", { used, total: cfg.pages }) : String(used);

  const link = document.createElement("a");
  link.className = "item";
  link.dataset.tab = TAB;
  link.dataset.group = "primary";
  link.textContent = t("PF1ESB.Source.Tab");
  after.after(link);

  const panel = document.createElement("div");
  panel.className = `tab ${TAB}-tab`;
  panel.dataset.group = "primary";
  panel.dataset.tab = TAB;
  panel.innerHTML = `
    <div class="${CSS}book-facts">
      <span><strong>${esc(t("PF1ESB.Book.Type"))}</strong> ${esc(className(item, cfg.class))}</span>
      <span><strong>${esc(t("PF1ESB.Book.Spells"))}</strong> ${resolved.length}</span>
      <span class="${cfg.pages && used > cfg.pages ? `${CSS}over` : ""}"><strong>${esc(t("PF1ESB.Book.Pages"))}</strong> ${esc(pages)}</span>
    </div>
    ${
      item.actor
        ? `<button type="button" class="${TAB}-open"><i class="fa-solid fa-book-open" inert></i> ${esc(t("PF1ESB.Tab.Open"))}</button>`
        : ""
    }
    <div class="${TAB}-list">${levels}</div>`;
  body.append(panel);

  panel.querySelector(`.${TAB}-open`)?.addEventListener("click", (event) => {
    event.preventDefault();
    openFromItem(item);
  });

  for (const anchor of panel.querySelectorAll("a[data-uuid]")) {
    anchor.addEventListener("click", async (event) => {
      event.preventDefault();
      const doc = await fromUuid(anchor.dataset.uuid).catch(() => null);
      if (doc) doc.sheet.render(true);
      else ui.notifications.warn("PF1ESB.Source.Missing", { localize: true });
    });
  }

  // The system bound its tabs before this one existed, so a redraw drops back to
  // another tab. Its click handling is delegated, so only the restore is needed.
  nav.addEventListener("click", (event) => {
    const clicked = event.target.closest("a[data-tab]");
    if (clicked) lastTab.set(app, clicked.dataset.tab);
  });
  if (lastTab.get(app) === TAB) app._tabs?.find((tabs) => tabs.group === "primary")?.activate(TAB);
}

export function registerSourceSection() {
  Hooks.on("renderItemSheetPF", (app, html) => {
    const item = app.item;
    if (!isSource(item)) return;
    try {
      const root = html?.[0] ?? html;
      const details = root?.querySelector?.('.tab[data-tab="details"]');
      if (details) injectConfig(app, details);
      injectTab(app, root).catch((err) => console.error(LOG, "Spellbook item tab failed", err));
    } catch (err) {
      console.error(LOG, "Spellbook item section failed", err);
    }
  });
}
