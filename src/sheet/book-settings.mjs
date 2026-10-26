/**
 * The Spellbook settings controls: access, and whose spellbooks the book reads.
 * Drawn on a feature's Grant block (through the API) and on an old-style class. §16.1, §26
 */

import { ACCESS, CSS, MODULE_ID } from "../const.mjs";
import { defaultReads, itemAccess } from "../books.mjs";

const M = `${CSS}class-access`;
const t = (key) => game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * The settings rows for an item, as elements to place.
 * @param {Item} item - Where the settings are stored
 * @param {object} options
 * @param {boolean} options.editable
 * @param {string} [options.tag] - Class tag of the book, for the default reads list
 * @returns {HTMLElement[]}
 */
export function bookSettingsElements(item, { editable, tag }) {
  const dis = editable ? "" : " disabled";
  const current = itemAccess(item) ?? "";
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
      <select${dis}>${options}</select>
    </div>`;

  // No `name`, so the sheet's own submit skips it.
  group.querySelector("select").addEventListener("change", (event) => {
    event.stopPropagation();
    item.update({ [`flags.${MODULE_ID}.book.access`]: event.currentTarget.value });
  });

  // Whose spellbooks the book can use. Only a book kept in spellbooks has the question. §16.1
  if (current !== ACCESS.learned) return [group];
  const reads = document.createElement("div");
  reads.className = `form-group ${M}-reads`;
  reads.innerHTML = `
    <label data-tooltip="PF1ESB.Class.ReadsHint">${esc(t("PF1ESB.Class.Reads"))}</label>
    <div class="form-fields">
      <input type="text" value="${esc(item.flags?.[MODULE_ID]?.book?.reads ?? "")}"
        placeholder="${esc(defaultReads(tag).join(", "))}"${dis}>
    </div>`;
  reads.querySelector("input").addEventListener("change", (event) => {
    event.stopPropagation();
    item.update({ [`flags.${MODULE_ID}.book.reads`]: event.currentTarget.value.trim() });
  });
  return [group, reads];
}

/** API entry: append the settings rows to a container another module drew. */
export function renderBookSettings(item, container, { editable = true, tag = "" } = {}) {
  if (!item || !container) return;
  container.append(...bookSettingsElements(item, { editable, tag }));
}
