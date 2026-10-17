/**
 * Actor sheet Settings tab: the actor's Use Enhanced Spellbooks switch, under the
 * system's Spellbook Usage. DESIGN.md §13.3.
 */

import { CSS, LOG, MODULE_ID } from "../const.mjs";
import { usesSpellbooks } from "../books.mjs";

const t = (key) => game.i18n.localize(key);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

function addSwitch(app, root) {
  const actor = app.actor;
  const section = root.querySelector(".tab.settings .spellbook-usage");
  if (!actor || !section || section.querySelector(`.${CSS}use-spellbooks`)) return;

  const el = document.createElement("label");
  el.className = `checkbox ${CSS}use-spellbooks`;
  el.dataset.tooltip = "PF1ESB.Actor.UseHint";
  el.innerHTML = `<input type="checkbox"${usesSpellbooks(actor) ? " checked" : ""}${actor.isOwner ? "" : " disabled"}> ${esc(t("PF1ESB.Actor.Use"))}`;
  section.append(el);

  // No `name`, so the sheet's own submit skips it and an untouched actor keeps the default.
  el.querySelector("input").addEventListener("change", (event) => {
    event.stopPropagation();
    actor
      .setFlag(MODULE_ID, "useSpellbooks", event.currentTarget.checked)
      .catch((err) => console.error(LOG, "saving Use Enhanced Spellbooks failed", err));
  });
}

export function registerSettingsTab() {
  Hooks.on("renderActorSheetPF", (app, html) => {
    try {
      const root = html?.[0] ?? html;
      if (root?.querySelector) addSwitch(app, root);
    } catch (err) {
      console.error(LOG, "Settings tab changes failed", err);
    }
  });
}
