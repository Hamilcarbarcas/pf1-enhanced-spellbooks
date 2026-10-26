/**
 * The Spellbook setting in a class item's spellcasting block. DESIGN.md §5.2, §13.3.
 * Shown only on a class that still has casting of its own; granted books keep the
 * setting on their feature instead. §26
 */

import { CSS, LOG } from "../const.mjs";
import { bookSettingsElements } from "./book-settings.mjs";

const M = `${CSS}class-access`;

function inject(app, html) {
  const item = app.item;
  if (item?.type !== "class") return;

  const root = html?.[0] ?? html;
  // Present only while the class has a casting type.
  const anchor = root?.querySelector?.(".spellcasting-cantrips");
  if (!anchor || root.querySelector(`.${M}`)) return;

  anchor.after(...bookSettingsElements(item, { editable: app.isEditable, tag: item.system?.tag }));
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
