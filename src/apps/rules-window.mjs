/**
 * The rule editor: slot rules and substitution rules, for a feature item or entered by
 * hand for one of an actor's books. DESIGN.md §14.4, §15.3.
 */

import { CSS, LOG, TEMPLATES } from "../const.mjs";
import { bookName } from "../books.mjs";
import {
  SUB_KIND,
  deleteRule,
  deleteSub,
  normalizeRule,
  normalizeSub,
  readRules,
  readSubs,
  ruleList,
  saveRule,
  saveSub,
  subList,
} from "../rules.mjs";
import { normalizeMetamagic, readMetamagic, saveMetamagic } from "../metamagic.mjs";
import { esc, t } from "./shared.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const M = `${CSS}rules`;

const KIND_LABELS = {
  [SUB_KIND.cure]: "PF1ESB.Sub.Kind.Cure",
  [SUB_KIND.inflict]: "PF1ESB.Sub.Kind.Inflict",
  [SUB_KIND.sna]: "PF1ESB.Sub.Kind.Sna",
  [SUB_KIND.domain]: "PF1ESB.Sub.Kind.Domain",
  [SUB_KIND.name]: "PF1ESB.Sub.Kind.Name",
  [SUB_KIND.traits]: "PF1ESB.Sub.Kind.Traits",
  [SUB_KIND.spells]: "PF1ESB.Sub.Kind.Spells",
};

/** One window per place rules are stored. */
const windows = new Map();

const windowId = (list) => `${M}-${list.doc.uuid.replaceAll(".", "-")}-${list.path.replaceAll(".", "-")}`;

/** A trait table from the system's config as `[{ value, label, selected }]`, by label. */
function options(table, chosen) {
  return Object.entries(table ?? {})
    .map(([value, label]) => ({ value, label: game.i18n.localize(label), selected: chosen.includes(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

class RulesWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [M],
    window: { icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 560, height: 680 },
    actions: {
      addRule: RulesWindow.#addRule,
      closeWindow: RulesWindow.#closeWindow,
      deleteRule: RulesWindow.#deleteRule,
      addSub: RulesWindow.#addSub,
      deleteSub: RulesWindow.#deleteSub,
      removeSpell: RulesWindow.#removeSpell,
    },
  };

  static PARTS = {
    body: { template: `${TEMPLATES}/rules-window.hbs`, scrollable: [`.${M}-list`] },
  };

  /** Where the slot rules and the substitution rules are stored. Same document, two paths. */
  #rules;
  #subs;
  /** The feat whose metamagic settings are edited here, or null when the rules are an actor's. §20 */
  #feat = null;

  constructor(target, bookId, name, options = {}) {
    const rules = ruleList(target, bookId);
    super({
      ...options,
      id: windowId(rules),
      window: { title: t("PF1ESB.Rules.Title", { name }) },
    });
    this.#rules = rules;
    this.#subs = subList(target, bookId);
    this.#feat = target.documentName === "Item" ? target : null;
  }

  async _prepareContext() {
    const rules = readRules(this.#rules).map((rule) => ({
      ...rule,
      schoolOptions: options(pf1.config.spellSchools, rule.schools),
      subschoolOptions: options(pf1.config.spellSubschools, rule.subschools),
      descriptorOptions: options(pf1.config.spellDescriptors, rule.descriptors),
    }));
    const subs = readSubs(this.#subs).map((sub) => ({
      ...sub,
      kinds: Object.entries(KIND_LABELS).map(([value, label]) => ({
        value,
        label: t(label),
        selected: value === sub.kind,
      })),
      byName: sub.kind === SUB_KIND.name,
      byTraits: sub.kind === SUB_KIND.traits,
      bySpells: sub.kind === SUB_KIND.spells,
      schoolOptions: options(pf1.config.spellSchools, sub.schools),
      subschoolOptions: options(pf1.config.spellSubschools, sub.subschools),
      descriptorOptions: options(pf1.config.spellDescriptors, sub.descriptors),
    }));
    const meta = this.#feat ? readMetamagic(this.#feat) : null;
    return {
      m: M,
      editable: this.#rules.doc.isOwner,
      rules,
      noRules: !rules.length,
      subs,
      noSubs: !subs.length,
      meta,
      metaPlaceholder: this.#feat?.name.replace(/\s+spell$/i, "") ?? "",
    };
  }

  /**
   * Every rule's fields share their names, and after a save redraws the window the
   * system puts focus back on the first field of that name: the first rule's, whichever
   * rule was clicked. Narrowed to the field's own block.
   */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    const focus = priorElement.querySelector(":focus");
    const block = focus?.closest("[data-rule], [data-sub], [data-meta]");
    if (!focus?.name || !block) return;
    const esc = globalThis.CSS.escape;
    const scope = block.dataset.rule
      ? `[data-rule="${esc(block.dataset.rule)}"]`
      : block.dataset.sub
        ? `[data-sub="${esc(block.dataset.sub)}"]`
        : "[data-meta]";
    state.focus = `${scope} ${focus.tagName}[name="${esc(focus.name)}"]`;
  }

  static #closeWindow() {
    this.close();
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const block of this.element.querySelectorAll("[data-rule]")) {
      block.addEventListener("change", (event) => {
        event.stopPropagation();
        this.#saveRule(block);
      });
    }
    this.element.querySelector("[data-meta]")?.addEventListener("change", (event) => {
      event.stopPropagation();
      this.#saveMeta(event.currentTarget);
    });
    for (const block of this.element.querySelectorAll("[data-sub]")) {
      block.addEventListener("change", (event) => {
        event.stopPropagation();
        this.#saveSub(block);
      });
      block.addEventListener("dragover", (event) => event.preventDefault());
      block.addEventListener("drop", (event) => this.#onDropSpell(event, block));
    }
  }

  /** Write one slot rule from its fields. */
  async #saveRule(block) {
    const field = (name) => block.querySelector(`[name="${name}"]`);
    const many = (name) => {
      const value = field(name)?.value;
      return Array.isArray(value) ? value : value ? [value].flat() : [];
    };
    const rule = normalizeRule(
      {
        name: field("name")?.value,
        granted: field("granted")?.checked,
        flexible: field("flexible")?.checked,
        schools: many("schools"),
        subschools: many("subschools"),
        descriptors: many("descriptors"),
        descriptorText: field("descriptorText")?.value,
        slots: field("slots")?.value,
        known: field("known")?.value,
        cost: field("cost")?.value,
      },
      block.dataset.rule
    );
    await this.#write(() => saveRule(this.#rules, rule));
  }

  /** Write one substitution rule from its fields. Its spells are kept as stored. */
  async #saveSub(block, spells = null) {
    const stored = readSubs(this.#subs).find((sub) => sub.id === block.dataset.sub);
    const field = (name) => block.querySelector(`[name="${name}"]`);
    // A field that isn't drawn for the rule's current kind keeps what was stored.
    const many = (name) => {
      const el = field(name);
      if (!el) return stored?.[name] ?? [];
      return Array.isArray(el.value) ? el.value : el.value ? [el.value].flat() : [];
    };
    const sub = normalizeSub(
      {
        name: field("name")?.value,
        kind: field("kind")?.value,
        text: field("text")?.value ?? stored?.text,
        schools: many("schools"),
        subschools: many("subschools"),
        descriptors: many("descriptors"),
        descriptorText: field("descriptorText")?.value ?? stored?.descriptorText,
        spells: spells ?? stored?.spells ?? [],
        sacrificeDomain: field("sacrificeDomain")?.checked,
      },
      block.dataset.sub
    );
    await this.#write(() => saveSub(this.#subs, sub));
  }

  /** Write the feat's metamagic settings from their fields. A field that isn't drawn keeps its value. */
  async #saveMeta(block) {
    const stored = readMetamagic(this.#feat);
    const field = (name) => block.querySelector(`[name="${name}"]`);
    const value = (name) => field(name)?.value ?? stored[name];
    const checked = (name, fallback) => field(name)?.checked ?? fallback;
    const settings = normalizeMetamagic({
      enabled: checked("enabled", stored.enabled),
      label: value("label"),
      levels: value("levels"),
      variable: checked("variable", stored.variable),
      heighten: checked("heighten", stored.heighten),
    });
    await this.#write(() => saveMetamagic(this.#feat, settings));
  }

  async #write(save) {
    try {
      await save();
      if (this.rendered) this.render();
    } catch (err) {
      console.error(LOG, "saving a rule failed", err);
    }
  }

  /** A spell dropped on a substitution rule that names its spells. */
  async #onDropSpell(event, block) {
    event.preventDefault();
    const stored = readSubs(this.#subs).find((sub) => sub.id === block.dataset.sub);
    if (stored?.kind !== SUB_KIND.spells) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const doc = await fromUuid(data.uuid).catch(() => null);
    if (doc?.type !== "spell") return void ui.notifications.warn("PF1ESB.Learn.Refused.NotSpell", { localize: true });
    // A spell on a character is named by where it came from, so the rule outlives it.
    const uuid = doc.isEmbedded ? doc._stats?.compendiumSource ?? doc.uuid : doc.uuid;
    if (stored.spells.some((spell) => spell.uuid === uuid)) return;
    await this.#saveSub(block, [...stored.spells, { uuid, name: doc.name }]);
  }

  static async #addRule() {
    await this.#write(() => saveRule(this.#rules, { slots: 1 }));
  }

  static async #addSub() {
    await this.#write(() => saveSub(this.#subs, { kind: SUB_KIND.cure }));
  }

  /** Ask, then delete one rule of either kind. */
  async #confirmDelete(block, remove) {
    const name = block.querySelector('[name="name"]')?.value || t("PF1ESB.Rules.Unnamed");
    const confirmed = await DialogV2.confirm({
      window: { title: "PF1ESB.Rules.DeleteTitle" },
      content: `<p>${t("PF1ESB.Rules.DeleteBody", { name: esc(name) })}</p>`,
    });
    if (confirmed) await this.#write(remove);
  }

  static async #deleteRule(event, target) {
    const block = target.closest("[data-rule]");
    await this.#confirmDelete(block, () => deleteRule(this.#rules, block.dataset.rule));
  }

  static async #deleteSub(event, target) {
    const block = target.closest("[data-sub]");
    await this.#confirmDelete(block, () => deleteSub(this.#subs, block.dataset.sub));
  }

  static async #removeSpell(event, target) {
    const block = target.closest("[data-sub]");
    const stored = readSubs(this.#subs).find((sub) => sub.id === block.dataset.sub);
    if (!stored) return;
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    await this.#saveSub(
      block,
      stored.spells.filter((spell) => spell.uuid !== uuid)
    );
  }

  _onClose(options) {
    super._onClose(options);
    windows.delete(this.id);
  }
}

/**
 * Open the rule editor.
 *
 * @param {Item|Actor} target  A feature item, or an actor together with `bookId`.
 * @param {string} [bookId]
 */
export function openRules(target, bookId = null) {
  const list = ruleList(target, bookId);
  if (!list) return null;
  let app = windows.get(windowId(list));
  if (!app) {
    const name = bookId ? `${bookName(target, bookId)} (${target.name})` : target.name;
    app = new RulesWindow(target, bookId, name);
    windows.set(app.id, app);
  }
  app.render({ force: true }).catch((err) => console.error(LOG, "the rule editor failed to open", err));
  return app;
}
