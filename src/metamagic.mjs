/**
 * Metamagic. This module handles the slot a metamagic costs: the higher level, the
 * name, the prompt, and the cast. What a metamagic does to the spell itself is a script
 * call on its feat, run with a few helpers. DESIGN.md §20.
 */

import { LOG, MODULE_ID } from "./const.mjs";
import { bookData } from "./books.mjs";

const { DialogV2 } = foundry.applications.api;

const FLAG = "metamagic";
/** The script-call category a metamagic feat's changes to a spell live under. */
export const SCRIPT_CATEGORY = "metamagic";
const COMPONENTS = ["verbal", "somatic", "material"];
/** Range steps a metamagic can move a spell along. */
const RANGE_STEPS = ["touch", "close", "medium", "long"];
/** Duration units that have no length to multiply. */
const UNTIMED = new Set(["", "inst", "perm", "spec", "seeText"]);

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));
const asInt = (value, min = 0) => Math.max(min, Math.floor(Number(value) || 0));

// Before the system's own init, which is when it builds its registries.
Hooks.on("pf1RegisterScriptCalls", (registry) => {
  try {
    registry.register(MODULE_ID, SCRIPT_CATEGORY, {
      itemTypes: ["feat"],
      name: "PF1ESB.Meta.ScriptName",
      info: "PF1ESB.Meta.ScriptInfo",
    });
  } catch (err) {
    console.error(LOG, "registering the metamagic script call failed", err);
  }
});

/** A metamagic's settings with every field present: only what its slot takes. */
export function normalizeMetamagic(raw) {
  return {
    enabled: raw?.enabled === true,
    // Goes before the spell's name. Blank uses the feat's name without a trailing "Spell".
    label: typeof raw?.label === "string" ? raw.label.trim() : "",
    // Slot levels added.
    levels: asInt(raw?.levels),
    // The caster picks how many levels to add, as with Heighten Spell.
    variable: raw?.variable === true,
    // The spell's own level rises with its slot, so its save DC does too.
    heighten: raw?.heighten === true,
  };
}

/** The metamagic settings stored on an item, enabled or not. */
export function readMetamagic(item) {
  return normalizeMetamagic(item?.flags?.[MODULE_ID]?.[FLAG]);
}

export async function saveMetamagic(item, settings) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG}`]: normalizeMetamagic(settings) });
}

/** What names a metamagic in a preparation: the feat's tag, so it survives the feat being re-added. */
function keyOf(item) {
  return item.system?.tag || pf1.utils.createTag(item.name);
}

/** The metamagics an actor has: every item on it with metamagic settings switched on. */
export function getMetamagics(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    const settings = readMetamagic(item);
    if (!settings.enabled) continue;
    out.push({
      ...settings,
      key: keyOf(item),
      name: item.name,
      label: settings.label || item.name.replace(/\s+spell$/i, ""),
      // The feat itself, for its script calls.
      item,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a preparation's metamagic list against what the actor has. An entry is a
 * metamagic's key, or `key:n` for one that adds a chosen number of levels. Unknown
 * entries are dropped.
 *
 * @returns {{meta: object, levels: number}[]}
 */
export function resolveMeta(list, metamagics) {
  const out = [];
  for (const entry of list ?? []) {
    const [key, chosen] = String(entry).split(":");
    const meta = metamagics.find((m) => m.key === key);
    if (!meta) continue;
    out.push({ meta, levels: meta.variable ? asInt(chosen, 1) : meta.levels });
  }
  return out;
}

/** Slot levels a metamagic list adds, and how many of those raise the spell's own level. */
export function metaLevels(list, metamagics) {
  let added = 0;
  let raised = 0;
  for (const { meta, levels } of resolveMeta(list, metamagics)) {
    added += levels;
    if (meta.heighten) raised += levels;
  }
  return { added, raised };
}

/** The names shown under a spell for its metamagics. */
export function metaLabels(list, metamagics) {
  return resolveMeta(list, metamagics).map(({ meta, levels }) =>
    meta.variable ? t("PF1ESB.Meta.Plus", { name: meta.name, levels }) : meta.name
  );
}

const times = (formula, factor) => `(${formula}) * ${factor}`;
const actionsOf = (spell) => spell?.system?.actions ?? [];

/**
 * What a metamagic script works with, passed to it as `meta`. Each takes the spell's
 * data (the script's `spell`) and changes it in place, so a script is mostly one line.
 * Kept here so a change to the system's data is answered in one place. §20.2
 */
export const helpers = {
  /** Multiply every timed duration. */
  duration(spell, factor) {
    for (const action of actionsOf(spell)) {
      if (action.duration?.value && !UNTIMED.has(action.duration.units ?? "")) {
        action.duration.value = times(action.duration.value, factor);
      }
    }
  },

  /** Multiply close, medium, long, and ranges in feet. A named range becomes feet. */
  range(spell, factor) {
    for (const action of actionsOf(spell)) {
      if (!action.range?.units) continue;
      const named = pf1.config.spellRangeFormulas?.[action.range.units];
      if (named) {
        action.range.value = times(named, factor);
        action.range.units = "ft";
      } else if (action.range.units === "ft" && action.range.value) {
        action.range.value = times(action.range.value, factor);
      }
    }
  },

  /** Move the range up: touch, close, medium, long. */
  rangeSteps(spell, steps = 1) {
    for (const action of actionsOf(spell)) {
      const at = RANGE_STEPS.indexOf(action.range?.units);
      if (at >= 0) action.range.units = RANGE_STEPS[Math.min(RANGE_STEPS.length - 1, at + asInt(steps))];
    }
  },

  /** Multiply the size of every measured template. */
  area(spell, factor) {
    for (const action of actionsOf(spell)) {
      if (action.measureTemplate?.size) action.measureTemplate.size = times(action.measureTemplate.size, factor);
    }
  },

  /** Multiply every damage formula, rounded down. */
  damage(spell, factor) {
    for (const action of actionsOf(spell)) {
      for (const part of action.damage?.parts ?? []) {
        if (part?.formula) part.formula = `floor(${times(part.formula, factor)})`;
      }
    }
  },

  /** Rewrite every damage formula with a function of the old one. */
  damageFormula(spell, change) {
    for (const action of actionsOf(spell)) {
      for (const part of action.damage?.parts ?? []) {
        if (part?.formula) part.formula = String(change(part.formula, part));
      }
    }
  },

  /** Drop components the spell no longer needs: "verbal", "somatic", "material". */
  removeComponents(spell, ...names) {
    const components = spell?.system?.components;
    if (!components) return;
    for (const name of names.flat()) if (COMPONENTS.includes(name)) components[name] = false;
  },

  /** Give every action an activation type, such as "swift", at a cost of one. */
  activation(spell, type, cost = 1) {
    for (const action of actionsOf(spell)) {
      if (!action.activation) continue;
      action.activation.type = type;
      action.activation.cost = cost;
    }
  },

  /** Add a line to the spell's footnotes, for an effect that is read and not computed. */
  note(spell, text) {
    if (!text || !spell?.system) return;
    spell.system.attackNotes = [...(spell.system.attackNotes ?? []), String(text)];
  },

  /** Every action's data, for a script that needs more than the helpers above. */
  actions: actionsOf,
};

/**
 * Apply metamagics to a spell's data, in place.
 *
 * This module's part is the slot: the spell moves up to the level its metamagics need,
 * the system's own level offset keeps its save DC where it was except for levels a
 * heightening metamagic adds, the name gains each label, and a spell changed at
 * casting takes a full round in place of a standard action.
 *
 * Each metamagic's own part follows, as the "Metamagic" script calls on its feat, with
 * `spell` (this data), `levels`, `spontaneous`, and `meta` (the helpers) in scope. A
 * script that sets a casting time of its own wins, since it runs last. §20.2
 *
 * @param {object} data            Spell item data: creation data, or `item.toObject()`.
 * @param {string[]} list          Metamagic entries, as stored on a preparation.
 * @param {object[]} metamagics    What the actor has: `getMetamagics(actor)`.
 * @param {object} [options]
 * @param {boolean} [options.spontaneous=false]  Applied at casting.
 * @returns {Promise<{added: number, raised: number, labels: string[]}>} What was applied.
 */
export async function applyMetamagic(data, list, metamagics, { spontaneous = false } = {}) {
  const resolved = resolveMeta(list, metamagics);
  const { added, raised } = metaLevels(list, metamagics);
  if (!resolved.length) return { added: 0, raised: 0, labels: [] };

  const system = (data.system ??= {});
  if (spontaneous) {
    for (const action of actionsOf(data)) {
      if (action.activation?.type === "standard") action.activation.type = "full";
    }
  }
  system.level = Math.min(9, (Number(system.level) || 0) + added);
  system.slOffset = (Number(system.slOffset) || 0) - (added - raised);
  data.name = `${resolved.map(({ meta }) => meta.label).join(" ")} ${data.name}`;

  for (const { meta, levels } of resolved) {
    try {
      await meta.item?.executeScriptCalls?.(SCRIPT_CATEGORY, { spell: data, levels, spontaneous, meta: helpers });
    } catch (err) {
      // The spell still takes its slot; only this metamagic's own changes are missing.
      console.error(LOG, `the metamagic script of "${meta.name}" failed`, err);
      ui.notifications?.warn(t("PF1ESB.Meta.ScriptFailed", { name: meta.name }));
    }
  }

  return { added, raised, labels: metaLabels(list, metamagics) };
}

/**
 * Ask which metamagics to apply. Resolves to the list as a preparation stores it, or
 * null when called off or nothing is picked.
 *
 * @param {object[]} metamagics
 * @param {object} options
 * @param {string} options.title
 * @param {(added: number) => string} [options.summary]  A line under the choices, redrawn
 *   as they change: what slot the spell will take.
 */
export async function chooseMetamagic(metamagics, { title, summary = null } = {}) {
  const rows = metamagics
    .map((meta) => {
      const levels = meta.variable
        ? `<input type="number" name="levels.${esc(meta.key)}" value="1" min="1" max="9" step="1">`
        : `<span class="pfesb-meta-levels">+${meta.levels}</span>`;
      return `<label class="pfesb-meta-row">
        <input type="checkbox" name="meta" value="${esc(meta.key)}">
        <span class="pfesb-meta-name">${esc(meta.name)}</span>
        ${levels}
      </label>`;
    })
    .join("");

  const read = (form) => {
    const picked = [...form.querySelectorAll('input[name="meta"]:checked')].map((box) => box.value);
    return picked.map((key) => {
      const meta = metamagics.find((m) => m.key === key);
      return meta?.variable ? `${key}:${asInt(form.elements[`levels.${key}`]?.value, 1)}` : key;
    });
  };

  const list = await DialogV2.prompt({
    classes: ["pfesb-meta"],
    window: { title },
    content: `<div class="pfesb-meta-list">${rows}</div><p class="pfesb-meta-summary"></p>`,
    ok: { label: "PF1ESB.Meta.Confirm", callback: (event, button) => read(button.form) },
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const line = form?.querySelector(".pfesb-meta-summary");
      if (!form || !line || !summary) return;
      const redraw = () => (line.textContent = summary(metaLevels(read(form), metamagics).added));
      form.addEventListener("change", redraw);
      redraw();
    },
    rejectClose: false,
  });
  return list?.length ? list : null;
}

/**
 * Cast a spell with metamagic applied at casting, for a book that casts from a pool.
 * The changed spell is a throwaway copy of the item, and one use is taken from the
 * level its metamagics raise it to. §20.4
 */
export async function castWithMetamagic(actor, item) {
  const metamagics = getMetamagics(actor);
  const bookId = item.system?.spellbook;
  const book = bookData(actor, bookId);
  if (!metamagics.length || !book) return;

  const base = item.system.level ?? 0;
  const left = (level) => book.spells?.[`spell${level}`]?.value ?? 0;
  const label = (level) => game.i18n.localize(pf1.config.spellLevels?.[level] ?? String(level));

  const list = await chooseMetamagic(metamagics, {
    title: t("PF1ESB.Meta.CastTitle", { name: item.name }),
    summary: (added) => {
      const level = base + added;
      if (level > 9) return t("PF1ESB.Meta.TooHigh");
      return t("PF1ESB.Meta.Slot", { level: label(level), left: left(level) });
    },
  });
  if (!list) return;

  const level = base + metaLevels(list, metamagics).added;
  if (level > 9) return void ui.notifications.warn("PF1ESB.Meta.TooHigh", { localize: true });
  if (left(level) <= 0) return void ui.notifications.warn(t("PF1ESB.Meta.NoneLeft", { level: label(level) }));

  try {
    const data = item.toObject();
    const { labels } = await applyMetamagic(data, list, metamagics, { spontaneous: true });
    helpers.note(data, t("PF1ESB.Meta.Footnote", { names: labels.join(", "), level: label(level) }));
    const changed = item.clone({ name: data.name, system: data.system }, { keepId: true });

    // Free of its own cast: the higher level pays, below.
    const result = await changed.use({ cost: 0 });
    if (!result || result.err || result.reject) return;

    await actor.update({
      [`system.attributes.spells.spellbooks.${bookId}.spells.spell${level}.value`]: Math.max(0, left(level) - 1),
    });
  } catch (err) {
    console.error(LOG, "casting with metamagic failed", err);
  }
}
