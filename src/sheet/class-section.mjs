/**
 * The Spellbook setting in a class item's spellcasting block. DESIGN.md §5.2, §13.3.
 */

import { ACCESS, CSS, LOG, MODULE_ID } from "../const.mjs";
import { classAccess, defaultReads } from "../books.mjs";

const M = `${CSS}class-access`;
const t = (key) => game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

function inject(app, html) {
  const item = app.item;
  if (item?.type !== "class") return;

  const root = html?.[0] ?? html;
  // Present only while the class has a casting type.
  const anchor = root?.querySelector?.(".spellcasting-cantrips");
  if (!anchor || root.querySelector(`.${M}`)) return;

  const current = classAccess(item) ?? "";
  const options = [
    ["", "PF1ESB.Access.None"],
    [ACCESS.learned, "PF1ESB.Access.Learned"],
    [ACCESS.all, "PF1ESB.Access.All"],
  ]
    .map(([value, key]) => `<option value="${value}"${value === current ? " selected" : ""}>${esc(t(key))}</option>`)
    .join("");

  const group = document.createElement("div");
  group.className = `form-group ${M}`;
  group.innerHTML = `
    <label data-tooltip="PF1ESB.Class.Hint">${esc(t("PF1ESB.Class.Label"))}</label>
    <div class="form-fields">
      <select${app.isEditable ? "" : " disabled"}>${options}</select>
    </div>`;
  anchor.after(group);

  // No `name`, so the sheet's own submit skips it.
  group.querySelector("select").addEventListener("change", (event) => {
    event.stopPropagation();
    item.update({ [`flags.${MODULE_ID}.book.access`]: event.currentTarget.value });
  });

  // Whose spellbooks the class can use. Only a class that keeps one has the question. §16.1
  if (current !== ACCESS.learned) return;
  const reads = document.createElement("div");
  reads.className = `form-group ${M}-reads`;
  reads.innerHTML = `
    <label data-tooltip="PF1ESB.Class.ReadsHint">${esc(t("PF1ESB.Class.Reads"))}</label>
    <div class="form-fields">
      <input type="text" value="${esc(item.flags?.[MODULE_ID]?.book?.reads ?? "")}"
        placeholder="${esc(defaultReads(item.system?.tag).join(", "))}"${app.isEditable ? "" : " disabled"}>
    </div>`;
  group.after(reads);
  reads.querySelector("input").addEventListener("change", (event) => {
    event.stopPropagation();
    item.update({ [`flags.${MODULE_ID}.book.reads`]: event.currentTarget.value.trim() });
  });
}

export function registerClassSection() {
  Hooks.on("renderItemSheetPF", (app, html) => {
    try {
      inject(app, html);
    } catch (err) {
      console.error(LOG, "class Spellbook setting failed", err);
    }
  });
}
