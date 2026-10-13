/**
 * The Prepare Spells window: today's loadout on the left, what can be picked from on
 * the right. Changes are staged and written by Apply. DESIGN.md §13.7, §13.9, §13.11,
 * §13.12.
 */

import { CSS, LOG, SLOT, TEMPLATES } from "../const.mjs";
import { restOnly } from "../settings.mjs";
import {
  PREVIOUS_PROFILE,
  bookName,
  bookOverride,
  deleteProfile,
  getProfiles,
  getSlots,
  isSchoolBook,
  listTag,
  saveProfile,
  spellCap,
} from "../books.mjs";
import { getBookList, getEntries, getSources, learn, resolveEntries, setEntryMark } from "../sources.mjs";
import { MARKS, getActorSpells, getPreparation, planKey, setItemMark, setPreparation } from "../prepare.mjs";
import { afterApply, clearPending, getPending, setPending } from "../pending.mjs";
import { chooseMetamagic, getMetamagics, metaLabels, metaLevels } from "../metamagic.mjs";
import { CHECK, checkSpell, getPool, resolveBorrowed, setCheck, syncKnown } from "../borrow.mjs";
import { syncRuleOffsets } from "../sync.mjs";
import { DEFAULT_GROUP, costOf, getGroups, getRules, groupOfGranted, knownBonus, matches } from "../rules.mjs";
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

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const M = `${CSS}prep`;
const MARK_NAMES = Object.keys(MARKS);

/** Plan key of a marked spell on the actor, which has no list entry. */
const grantedKey = (itemId) => `item:${itemId}`;
/** The picker's choice for spells that need no spellbook: held in memory, or granted. */
const LOOSE = "none";

/**
 * What the window is for. §18
 * - apply: Apply writes the loadout to the actor.
 * - stage: Apply sets the loadout aside, to be applied when a rest ends.
 * - fill:  what is on the actor is fixed; only additions can be made.
 */
export const MODE = { apply: "apply", stage: "stage", fill: "fill" };

/** One window per actor and book. */
const windows = new Map();

class PrepareWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [M],
    window: { icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 860, height: 680 },
    actions: {
      add: PrepareWindow.#add,
      addMeta: PrepareWindow.#addMeta,
      check: PrepareWindow.#check,
      addSpecial: PrepareWindow.#addSpecial,
      increase: PrepareWindow.#increase,
      decrease: PrepareWindow.#decrease,
      remove: PrepareWindow.#remove,
      markLine: PrepareWindow.#markLine,
      markDefault: PrepareWindow.#markDefault,
      favor: PrepareWindow.#favor,
      expand: PrepareWindow.#expand,
      view: PrepareWindow.#view,
      browse: PrepareWindow.#browse,
      toggleLevel: PrepareWindow.#toggleLevel,
      clear: PrepareWindow.#clear,
      reset: PrepareWindow.#reset,
      discardPending: PrepareWindow.#discardPending,
      apply: PrepareWindow.#apply,
      saveProfile: PrepareWindow.#saveProfile,
      loadProfile: PrepareWindow.#loadProfile,
      deleteProfile: PrepareWindow.#deleteProfile,
    },
  };

  static PARTS = {
    body: { template: `${TEMPLATES}/prepare-window.hbs`, scrollable: [`.${M}-loadout`, `.${M}-book`] },
  };

  #actor;
  #bookId;
  /** @type {Map<string, object>|null} Staged loadout by plan key; null until first read. */
  #plan = null;
  #dirty = false;
  #busy = false;
  /** What the book prepares from, as of the last draw. See `getBookList`. */
  #list = { kind: null, target: null, item: null, available: false };
  /** Spells in the book's list right now, by uuid. */
  #known = new Map();
  /** Spells staged from outside the list, by uuid. Only a favored list allows them. §13.12 */
  #extra = new Map();
  /** Spell items on the actor that are prepared as they stand, marked or granted, by item id. §5.6, §24 */
  #candidates = new Map();
  /** The book's slot rules and the groups of special slots they make, as of the last draw. §14 */
  #rules = [];
  #groups = [];
  /** The metamagics the actor has, as of the last draw. §20 */
  #metamagics = [];
  /** Whether the list is pooled from spellbooks and memory, as a Learned book's is. §21 */
  #pooled = false;
  /** A check on a borrowed spell is being rolled. */
  #checking = false;
  /** The spellbook item the right side is narrowed to, by id, or "" for all of them. §25 */
  #source = "";
  /** Whoever opened the window vouches for applying from it, as a rest manager does. §25 */
  #allowed = false;
  #canAdd = false;
  #cap = Infinity;
  #mode = MODE.apply;
  /** What the last Apply did, for whoever is waiting on the window: "applied", "staged", or null. */
  #outcome = null;
  #waiting = [];
  #collapsed = new Set();
  /** Rows whose details are open, by their `data-row`. */
  #expanded = new Set();
  #filter = "";
  #profile = "";

  constructor(actor, bookId, options = {}) {
    super({
      ...options,
      id: windowId(M, actor, bookId),
      window: { title: t("PF1ESB.Prep.Title", { book: bookName(actor, bookId), actor: actor.name }) },
    });
    this.#actor = actor;
    this.#bookId = bookId;
    track(this, actor);
  }

  /** Switch what the window is for. A change of purpose starts the loadout over. */
  setMode(mode) {
    const next = Object.values(MODE).includes(mode) ? mode : MODE.apply;
    if (next === this.#mode) return;
    this.#mode = next;
    this.#plan = null;
    this.#profile = "";
  }

  /** Let this window apply while spells may only be prepared after a rest. */
  setAllowed(allowed) {
    this.#allowed = allowed === true;
  }

  /**
   * Whether applying is held back: the world prepares only after a rest, and no rest has
   * offered this book its preparation. Setting a loadout aside is not applying, a GM
   * is not held back, and a caller that vouches for the window is taken at its word. §25
   */
  get #locked() {
    if (!restOnly() || this.#mode !== MODE.apply || this.#allowed || game.user.isGM) return false;
    return bookOverride(this.#actor, this.#bookId).ticket !== true;
  }

  /** Resolves when the window closes, with what its last Apply did: "applied", "staged", or null. */
  whenDone() {
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  /** In fill mode, the count a line can't go below: what is on the actor now. */
  #floor(key) {
    return this.#mode === MODE.fill ? this.#actual().get(key)?.count ?? 0 : 0;
  }

  /** Whether any spell on the class list may be staged, not only those in the list. */
  get #open() {
    return this.#list.kind === "favored";
  }

  /** What is prepared on the actor right now, as staged lines by key. */
  #actual() {
    const actor = this.#actor;
    const plan = new Map();
    for (const line of getPreparation(actor, this.#bookId)) {
      const item = actor.items.get(line.itemId);
      const key = line.granted ? grantedKey(line.itemId) : planKey(line.uuid, line.slot, line.meta, line.rule);
      plan.set(key, {
        granted: !!line.granted,
        itemId: line.granted ? line.itemId : null,
        // A marked spell is viewed as the actor's own item.
        uuid: line.granted ? item?.uuid : line.uuid,
        slot: line.slot,
        rule: line.rule ?? null,
        cost: line.cost ?? 1,
        marked: line.granted ? line.slot === SLOT.special : !!line.marked,
        meta: line.meta,
        count: line.count,
        name: line.name,
        img: item?.img ?? null,
        level: line.level,
        combat: line.combat,
        quick: line.quick,
      });
    }
    return plan;
  }

  /** Whether the staged loadout differs from what is on the actor. */
  #differs() {
    const actual = this.#actual();
    if (actual.size !== this.#plan.size) return true;
    for (const [key, line] of this.#plan) {
      const other = actual.get(key);
      if (!other || other.count !== line.count) return true;
      if (MARK_NAMES.some((mark) => !!other[mark] !== !!line[mark])) return true;
    }
    return false;
  }

  /** Look up spells that aren't in the list, so they can be staged. Favored lists only. */
  async #resolve(uuids) {
    const wanted = [...new Set(uuids)].filter((uuid) => uuid && !this.#known.has(uuid) && !this.#extra.has(uuid));
    if (!this.#open || !wanted.length) return;
    const entries = wanted.map((uuid) => ({ id: null, uuid, name: "" }));
    for (const entry of await resolveEntries(entries, listTag(this.#actor, this.#bookId))) {
      if (!entry.missing && entry.type === "spell") this.#extra.set(entry.uuid, entry);
    }
  }

  #lookup(uuid) {
    return this.#known.get(uuid) ?? this.#extra.get(uuid) ?? null;
  }

  /**
   * Turn saved plan lines into a staged loadout. Spells that can no longer be picked
   * are left out and counted.
   *
   * @returns {Promise<{plan: Map<string, object>, skipped: number}>}
   */
  async #stage(lines) {
    await this.#resolve((lines ?? []).map((line) => line.uuid));

    const plan = new Map();
    let skipped = 0;
    for (const line of lines ?? []) {
      const count = Math.min(this.#cap, Math.max(1, Math.floor(Number(line.count) || 1)));
      const granted = !!line.itemId && !line.uuid;
      // A granted spell may have been recreated since; fall back to its name.
      const source = granted
        ? this.#candidates.get(line.itemId) ?? [...this.#candidates.values()].find((s) => s.name === line.name)
        : this.#lookup(line.uuid);
      if (!source) {
        skipped++;
        continue;
      }
      // A special slot whose rule is gone falls back to an ordinary slot.
      const group = !granted && line.slot === SLOT.special ? this.#groups.find((g) => g.key === line.rule) : null;
      const slot = (granted ? source.marked : group) ? SLOT.special : SLOT.regular;
      const rule = group?.key ?? null;
      const key = granted ? grantedKey(source.itemId) : planKey(line.uuid, slot, line.meta, rule);
      plan.set(key, {
        granted,
        itemId: granted ? source.itemId : null,
        uuid: source.uuid,
        slot,
        rule,
        cost: slot === SLOT.special ? 1 : costOf(this.#rules, source),
        marked: granted ? source.marked : group?.marked ?? false,
        meta: granted ? [] : line.meta ?? [],
        count,
        name: source.name,
        img: source.img,
        level: granted ? source.level : Math.min(9, source.level + metaLevels(line.meta, this.#metamagics).added),
        combat: line.combat ?? source.combat ?? false,
        quick: line.quick ?? source.quick ?? false,
      });
    }
    return { plan, skipped };
  }

  async _prepareContext() {
    const actor = this.#actor;
    const bookId = this.#bookId;

    const list = getBookList(actor, bookId);
    // A Learned book prepares from every spellbook it can use, and from memory. §21
    const pool = list.kind === "source" ? await getPool(actor, bookId) : null;
    const resolved = pool
      ? pool.entries
      : list.target
        ? await resolveEntries(getEntries(list.target), listTag(actor, bookId))
        : [];
    const known = resolved.filter((entry) => !entry.missing);
    this.#pooled = !!pool;
    const candidates = getActorSpells(actor, bookId);
    // Marked ones fill special slots; the rest are a feature's grants, in ordinary slots.
    const specials = candidates.filter((spell) => spell.marked);
    const grants = candidates.filter((spell) => !spell.marked);
    this.#list = list;
    this.#known = new Map(known.map((entry) => [entry.uuid, entry]));
    this.#candidates = new Map(candidates.map((spell) => [spell.itemId, spell]));
    this.#cap = spellCap(actor, bookId);
    this.#canAdd = actor.isOwner && (list.available || known.length > 0);

    const rules = getRules(actor, bookId);
    const groups = getGroups(actor, bookId, rules);
    this.#rules = rules;
    this.#groups = groups;
    this.#metamagics = getMetamagics(actor);
    const kind = game.i18n.localize(isSchoolBook(actor, bookId) ? "PF1.School" : "PF1.Domain");
    const specialLabel = t("PF1ESB.Prep.SpecialSpells", { kind });
    // The group a staged line sits in, or null for an ordinary slot.
    const groupKey = (line) => {
      if (line.slot !== SLOT.special) return null;
      if (line.granted) return groupOfGranted(actor, actor.items.get(line.itemId), groups);
      return groups.some((g) => g.key === line.rule) ? line.rule : DEFAULT_GROUP;
    };

    const stored = getProfiles(actor, bookId);
    const pending = getPending(actor, bookId);
    if (!this.#plan && this.#mode === MODE.fill) {
      // Filling starts from what is on the actor, and only adds to it. §18
      this.#plan = this.#actual();
      this.#dirty = false;
    } else if (!this.#plan && this.#mode === MODE.stage && pending) {
      // Carries on from the choice already set aside.
      this.#plan = (await this.#stage(pending)).plan;
      this.#dirty = false;
    }
    if (!this.#plan) {
      // Opens on the last loadout applied, when there is one. §13.11
      const previous = stored.find((p) => p.previous);
      if (previous) {
        this.#plan = (await this.#stage(previous.plan)).plan;
        this.#profile = PREVIOUS_PROFILE;
        this.#dirty = this.#differs();
      } else {
        this.#plan = this.#actual();
        this.#dirty = false;
      }
    }

    let notice = "";
    if (list.kind === "source" && !list.item) notice = t("PF1ESB.Prep.NoBook");
    else if (list.kind === "source" && !list.available) notice = t("PF1ESB.Book.NotCarried", { name: list.item.name });

    const fill = this.#mode === MODE.fill;
    const staging = this.#mode === MODE.stage;
    const floors = fill ? this.#actual() : new Map();
    let modeNote = "";
    if (fill) modeNote = t("PF1ESB.Prep.FillNote");
    else if (staging) modeNote = t(pending ? "PF1ESB.Prep.StageNoteSet" : "PF1ESB.Prep.StageNote");
    else if (pending) modeNote = t("PF1ESB.Prep.PendingNote");
    const locked = this.#locked;
    if (locked) modeNote = t("PF1ESB.Prep.RestOnlyNote");

    // Left: the staged loadout, on every level the book can cast.
    const planned = new Map();
    const plannedCount = new Map();
    for (const [key, line] of this.#plan) {
      // An ordinary slot's cost follows the rules as they stand now.
      const entry = line.granted ? null : this.#lookup(line.uuid);
      if (entry && line.slot !== SLOT.special) line.cost = costOf(rules, entry);
      if (!planned.has(line.level)) planned.set(line.level, []);
      planned.get(line.level).push({
        ...line,
        key,
        row: `L:${key}`,
        group: groupKey(line),
        metaLabels: metaLabels(line.meta, this.#metamagics),
        costly: line.cost > 1,
        atCap: line.count >= this.#cap,
        // A spell already on the actor can be added to but not reduced while filling.
        fixed: floors.has(key),
        atFloor: line.count <= (floors.get(key)?.count ?? 0),
        // Whether a spell staged from outside a favored list could be added to it.
        favorable: this.#open && !line.granted && !this.#known.has(line.uuid),
      });
      const id = line.granted ? grantedKey(line.itemId) : `${line.uuid}|${line.rule ?? ""}`;
      plannedCount.set(id, (plannedCount.get(id) ?? 0) + line.count);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    const sum = (lines) => lines.reduce((total, line) => total + line.count * (line.cost ?? 1), 0);
    const bonus = knownBonus(actor, bookId, rules);

    const loadout = [];
    for (const slot of getSlots(actor, bookId)) {
      const lines = planned.get(slot.level) ?? [];
      if (!slot.castable && !lines.length) continue;
      const regular = lines.filter((line) => !line.group).sort(byName);
      // Extra spells a hybrid rule adds are counted in its own group, not here.
      const room = Math.max(0, slot.regular - (slot.level > 0 ? bonus : 0));
      const sections = groups
        .map((group) => {
          const own = lines.filter((line) => line.group === group.key).sort(byName);
          const capacity = slot.level > 0 ? group.capacity : 0;
          return {
            name: group.name || specialLabel,
            used: sum(own),
            capacity,
            over: sum(own) > capacity,
            // Nothing is chosen for a flexible group until a spell is cast from it. §17
            flexible: group.flexible,
            lines: own,
          };
        })
        .filter((section) => section.capacity > 0 || section.lines.length);
      loadout.push({
        level: slot.level,
        label: levelLabel(slot.level),
        used: sum(regular),
        regular: room,
        over: sum(regular) > room,
        lines: regular,
        groups: sections,
        collapsed: this.#collapsed.has(`left:${slot.level}`),
      });
    }

    // Right: the list, with the marked spells on the actor leading each level.
    const viaOf = (entry) => {
      if (!pool) return {};
      if (entry.borrowed) {
        if (entry.unknown) {
          return { locked: true, unknown: true, viaIcon: "fa-circle-question", viaTip: t("PF1ESB.Known.Unknown", { book: entry.viaName }) };
        }
        // Unchecked: the check is a button in place of the plus, and no icon yet. §21.3
        if (!entry.check) return { needsCheck: true, checkTip: t("PF1ESB.Borrow.Check", { book: entry.viaName, dc: entry.dc }) };
        // A GM can reverse a result by right-clicking its icon.
        const gm = game.user.isGM ? ` ${t("PF1ESB.Borrow.GmFlip")}` : "";
        if (entry.check === CHECK.fail) {
          return {
            locked: true,
            barred: true,
            checkState: CHECK.fail,
            viaIcon: "fa-ban",
            viaTip: t("PF1ESB.Borrow.Failed", { book: entry.viaName }) + gm,
          };
        }
        return {
          checkState: CHECK.pass,
          viaIcon: "fa-circle-check pfesb-passed",
          viaTip: t("PF1ESB.Borrow.ViaPassed", { book: entry.viaName }) + gm,
        };
      }
      // In no spellbook at hand: held in memory alone.
      if (entry.memory && !entry.sourceId) return { viaIcon: "fa-brain", viaTip: t("PF1ESB.Borrow.FromMemory") };
      return {};
    };
    const withPlanned = (id, entry, extra = {}) => {
      const count = plannedCount.get(id) ?? 0;
      const via = viaOf(entry);
      const atCap = count >= this.#cap;
      // A book that prepares each spell once shows a staged spell by a green plus, not a count.
      const added = this.#cap === 1 && count > 0;
      return { ...entry, ...via, ...extra, row: `R:${id}`, planned: count, atCap, added, addOff: atCap || !!via.barred || !!via.unknown };
    };
    const claims = new Map(specials.map((spell) => [spell.itemId, groupOfGranted(actor, actor.items.get(spell.itemId), groups)]));
    // The loadout can draw on every spellbook at once; the picker only narrows what is
    // listed. A spell held by two is listed under the one it would be prepared from.
    // LOOSE lists what needs no spellbook: spells held in memory, and a feature's grants.
    const sources = pool?.sources ?? [];
    const hasLoose = !!pool && (known.some((entry) => entry.memory) || grants.length > 0);
    if (this.#source !== LOOSE || !hasLoose) {
      if (!sources.some((source) => source.id === this.#source)) this.#source = "";
    }
    const loose = this.#source === LOOSE;
    const shown = loose
      ? known.filter((entry) => entry.memory)
      : this.#source
        ? known.filter((entry) => entry.sourceId === this.#source)
        : known;
    const ownership = (source) => t(source.own ? "PF1ESB.Book.Own" : "PF1ESB.Book.Borrowed");
    const grantsShown = !this.#source || loose ? grants : [];
    const grantGroups = new Map(groupByLevel(grantsShown).map((group) => [group.level, group.entries]));
    const grantTip = t("PF1ESB.Prep.Granted");
    const bookGroups = new Map(groupByLevel(shown).map((group) => [group.level, group.entries]));
    const specialGroups = new Map(groupByLevel(specials).map((group) => [group.level, group.entries]));
    const book = [...new Set([...bookGroups.keys(), ...specialGroups.keys(), ...grantGroups.keys()])]
      .sort((a, b) => a - b)
      .map((level) => {
        const entries = bookGroups.get(level) ?? [];
        const special = specialGroups.get(level) ?? [];
        const granted = (grantGroups.get(level) ?? []).map((spell) =>
          withPlanned(grantedKey(spell.itemId), spell, { granted: true, viaIcon: "fa-gift", viaTip: grantTip })
        );
        // Each group leads the level with what can fill it: marked spells on the actor
        // it claims, or the list's spells that fit its rule. §14.3
        const sections = (level > 0 ? groups : [])
          .map((group) => {
            const granted = special
              .filter((spell) => claims.get(spell.itemId) === group.key)
              .map((spell) => withPlanned(grantedKey(spell.itemId), spell, { granted: true }));
            const fitting =
              group.rule && !group.granted
                ? entries
                    .filter((entry) => matches(group.rule, entry))
                    .map((entry) => withPlanned(`${entry.uuid}|${group.key}`, entry, { rule: group.key }))
                : [];
            // A flexible group's spells are listed for reference and can't be staged.
            const rows = [...granted, ...fitting].map((row) => ({ ...row, flex: group.flexible, locked: group.flexible || row.locked === true }));
            return { name: group.name || specialLabel, rows };
          })
          .filter((section) => section.rows.length);
        return {
          level,
          label: levelLabel(level),
          count: entries.length + special.length + granted.length,
          collapsed: this.#collapsed.has(`right:${level}`),
          groups: sections,
          entries: [
            ...granted,
            ...entries.map((entry) => {
              const cost = costOf(rules, entry);
              return withPlanned(`${entry.uuid}|`, entry, { cost, costly: cost > 1, offList: entry.onList === false });
            }),
          ],
        };
      });

    const profiles = stored.map((p) => ({ ...p, selected: p.id === this.#profile }));
    if (!profiles.some((p) => p.selected)) this.#profile = "";

    return {
      m: M,
      notice,
      loadout,
      book,
      bookEmpty: (!!list.target || !!pool) && !known.length && !candidates.length,
      bookLabel: t(this.#open ? "PF1ESB.Book.Favored" : "PF1ESB.Prep.Spellbook"),
      // One spellbook is named; several become a choice of which to list.
      bookSingle: sources.length === 1 && !hasLoose ? { name: sources[0].name, tag: ownership(sources[0]) } : null,
      bookChoices:
        sources.length + (hasLoose ? 1 : 0) > 1
          ? [
              { id: "", label: t("PF1ESB.Prep.AllBooks"), selected: !this.#source },
              ...sources.map((source) => ({
                id: source.id,
                label: t("PF1ESB.Book.Option", { name: source.name, tag: ownership(source) }),
                selected: source.id === this.#source,
              })),
              ...(hasLoose ? [{ id: LOOSE, label: t("PF1ESB.Prep.WithoutBook"), selected: loose }] : []),
            ]
          : null,
      emptyLabel: t(
        pool && !list.available ? "PF1ESB.Borrow.Empty" : this.#open ? "PF1ESB.Prep.FavoredEmpty" : "PF1ESB.Source.Empty"
      ),
      editable: actor.isOwner,
      canAdd: this.#canAdd,
      // A favored list takes any spell of the class, so each level can be browsed. §13.12
      open: this.#open && this.#canAdd,
      canMeta: this.#canAdd && this.#metamagics.length > 0,
      single: this.#cap === 1,
      dirty: this.#dirty,
      hasLines: this.#plan.size > 0,
      modeNote,
      fill,
      staging,
      // A choice set aside can be dropped from the ordinary window.
      canDiscard: !fill && !staging && !!pending && actor.isOwner,
      applyLabel: t(staging ? "PF1ESB.Prep.Stage" : "PF1ESB.Prep.Apply"),
      locked,
      filter: this.#filter,
      profiles,
      hasProfile: !!this.#profile,
      canDelete: !!this.#profile && this.#profile !== PREVIOUS_PROFILE,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const body = this.element.querySelector(`.${M}-body`);
    if (!body) return;

    const filter = body.querySelector(`.${M}-filter`);
    filter?.addEventListener("input", () => {
      this.#filter = filter.value;
      this.#applyFilter();
    });
    this.#applyFilter();

    // A GM reverses a check by right-clicking its icon: passed to failed, failed to passed.
    if (game.user.isGM) {
      for (const icon of body.querySelectorAll(".pfesb-via-icon[data-check]")) {
        icon.addEventListener("contextmenu", async (event) => {
          event.preventDefault();
          const row = icon.closest("[data-source-id]");
          const item = getSources(this.#actor).find((source) => source.id === row?.dataset.sourceId);
          if (!item || !row.dataset.entry) return;
          const next = icon.dataset.check === CHECK.pass ? CHECK.fail : CHECK.pass;
          await setCheck(item, this.#actor, row.dataset.entry, next).catch((err) => console.error(LOG, "reversing a check failed", err));
        });
      }
    }

    body.querySelector(`.${M}-source`)?.addEventListener("change", (event) => {
      this.#source = event.currentTarget.value;
      this.render();
    });

    body.querySelector(`.${M}-profile`)?.addEventListener("change", (event) => {
      this.#profile = event.currentTarget.value;
      this.render();
    });

    const open = new Set();
    for (const row of body.querySelectorAll("[data-row]")) {
      if (!this.#expanded.has(row.dataset.row)) continue;
      open.add(row.dataset.row);
      openSummary(row, { secrets: this.#actor.isOwner });
    }
    this.#expanded = open;

    for (const input of body.querySelectorAll(`.${M}-count`)) {
      input.addEventListener("change", () => this.#setCount(input.closest("[data-key]").dataset.key, Number(input.value)));
    }

    for (const row of body.querySelectorAll(`.${M}-book [draggable="true"]`)) {
      row.addEventListener("dragstart", (event) => {
        const data = {
          type: "Item",
          uuid: row.dataset.uuid,
          itemId: row.dataset.item ?? null,
          rule: row.dataset.rule ?? null,
        };
        event.dataTransfer.setData("text/plain", JSON.stringify(data));
      });
    }

    const dropData = (event) => {
      event.preventDefault();
      return foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    };
    const left = body.querySelector(`.${M}-left`);
    left?.addEventListener("dragover", (event) => event.preventDefault());
    left?.addEventListener("drop", (event) => {
      const data = dropData(event);
      if (data?.itemId && this.#candidates.has(data.itemId)) this.#addGranted(data.itemId);
      else if (data?.type === "Item" && data.uuid) this.#addSpell(data.uuid, data.rule || null);
    });

    // A favored list also takes spells dropped straight onto it.
    if (!context.open) return;
    const right = body.querySelector(`.${M}-right`);
    right?.addEventListener("dragover", (event) => event.preventDefault());
    right?.addEventListener("drop", async (event) => {
      const data = dropData(event);
      if (data?.type !== "Item" || !data.uuid || data.itemId) return;
      await learn(this.#list.target, data.uuid).catch((err) => console.error(LOG, "adding a favored spell failed", err));
    });
  }

  #applyFilter() {
    const needle = this.#filter.trim().toLowerCase();
    for (const row of this.element.querySelectorAll(`.${M}-book li[data-name]`)) {
      row.hidden = !!needle && !row.dataset.name.toLowerCase().includes(needle);
    }
  }

  /**
   * Stage one more preparation of a spell from the list, or from the class list when it
   * is open. With `rule`, it goes into that rule's special slot.
   */
  async #addSpell(uuid, rule = null, meta = []) {
    if (!this.#canAdd) return;
    const group = rule ? this.#groups.find((g) => g.key === rule) : null;
    if (rule && !group) return;
    let entry = this.#known.get(uuid);
    // A borrowed spellbook serves only spells the book knows. §21.3
    if (entry?.borrowed && entry.unknown) {
      return void ui.notifications.warn(t("PF1ESB.Known.Unknown", { book: entry.viaName }));
    }
    // A borrowed spell is added only once its Spellcraft check has passed. §21.3
    if (entry?.borrowed && entry.check !== CHECK.pass) {
      const key = entry.check === CHECK.fail ? "PF1ESB.Borrow.Failed" : "PF1ESB.Borrow.CheckFirst";
      return void ui.notifications.warn(t(key, { book: entry.viaName, spell: entry.name }));
    }
    if (!entry && this.#open) {
      await this.#resolve([uuid]);
      entry = this.#extra.get(uuid);
      if (!entry) return void ui.notifications.warn("PF1ESB.Learn.Refused.NotSpell", { localize: true });
      if (!entry.onList) ui.notifications.warn(t("PF1ESB.Prep.OffList", { name: entry.name }));
    }
    if (!entry) return;
    const slot = group ? SLOT.special : SLOT.regular;
    this.#bump(planKey(uuid, slot, meta, rule), {
      granted: false,
      itemId: null,
      uuid,
      slot,
      rule,
      cost: group ? 1 : costOf(this.#rules, entry),
      marked: group?.marked ?? false,
      meta: [...meta].sort(),
      name: entry.name,
      img: entry.img,
      // A spell with metamagic is prepared in the higher slot it needs. §20
      level: Math.min(9, entry.level + metaLevels(meta, this.#metamagics).added),
      combat: !!entry.combat,
      quick: !!entry.quick,
    });
  }

  /** Stage a marked spell on the actor into a special slot. */
  #addGranted(itemId) {
    const spell = this.#candidates.get(itemId);
    if (!spell || !this.#actor.isOwner) return;
    this.#bump(grantedKey(itemId), {
      granted: true,
      itemId,
      uuid: spell.uuid,
      slot: spell.marked ? SLOT.special : SLOT.regular,
      rule: null,
      cost: 1,
      marked: spell.marked,
      meta: [],
      name: spell.name,
      img: spell.img,
      level: spell.level,
      combat: spell.combat,
      quick: spell.quick,
    });
  }

  /** Add one to a line, creating it from `fresh` when it isn't staged yet. */
  #bump(key, fresh) {
    const line = this.#plan.get(key);
    if (line) {
      if (line.count >= this.#cap) return;
      line.count++;
    } else {
      this.#plan.set(key, { ...fresh, count: 1 });
    }
    this.#changed();
  }

  #setCount(key, count) {
    const line = this.#plan.get(key);
    if (!line) return;
    const next = Math.min(this.#cap, Math.max(this.#floor(key), Math.floor(Number(count) || 0)));
    if (next === 0) this.#plan.delete(key);
    else line.count = next;
    this.#changed();
  }

  #changed() {
    this.#dirty = true;
    this.render();
  }

  static #add(event, target) {
    const row = target.closest("[data-uuid]");
    this.#addSpell(row.dataset.uuid, row.dataset.rule || null);
  }

  /** Roll the Spellcraft check a borrowed spell needs before it can be added. §21.3 */
  static async #check(event, target) {
    const entry = this.#lookup(target.closest("[data-uuid]")?.dataset.uuid);
    if (!entry?.borrowed || entry.unknown || entry.check || this.#checking) return;
    this.#checking = true;
    let result = null;
    try {
      result = await checkSpell(this.#actor, entry);
    } finally {
      this.#checking = false;
    }
    if (result === CHECK.fail) ui.notifications.warn(t("PF1ESB.Borrow.FailedNow", { spell: entry.name, book: entry.viaName }));
    if (this.rendered) this.render();
  }

  /** Stage a spell with metamagic: ask which, then add it at the level that takes. */
  static async #addMeta(event, target) {
    const row = target.closest("[data-uuid]");
    const entry = this.#lookup(row.dataset.uuid);
    if (!entry || !this.#metamagics.length) return;
    const meta = await chooseMetamagic(this.#metamagics, {
      title: t("PF1ESB.Meta.PrepareTitle", { name: entry.name }),
      summary: (added) => {
        const level = entry.level + added;
        return level > 9 ? t("PF1ESB.Meta.TooHigh") : t("PF1ESB.Meta.PrepareSlot", { level: levelLabel(level) });
      },
    });
    if (!meta) return;
    if (entry.level + metaLevels(meta, this.#metamagics).added > 9) {
      return void ui.notifications.warn("PF1ESB.Meta.TooHigh", { localize: true });
    }
    await this.#addSpell(row.dataset.uuid, row.dataset.rule || null, meta);
  }

  static #addSpecial(event, target) {
    this.#addGranted(target.closest("[data-item]").dataset.item);
  }

  static #increase(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    this.#setCount(key, (this.#plan.get(key)?.count ?? 0) + 1);
  }

  static #decrease(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    this.#setCount(key, (this.#plan.get(key)?.count ?? 0) - 1);
  }

  static #remove(event, target) {
    this.#setCount(target.closest("[data-key]").dataset.key, 0);
  }

  /** Toggle a mark on one staged line. It applies to this loadout only. */
  static #markLine(event, target) {
    const key = target.closest("[data-key]").dataset.key;
    const line = this.#plan.get(key);
    const mark = target.dataset.mark;
    if (!line || !MARK_NAMES.includes(mark)) return;
    // A spell already memorized is left exactly as it is while filling.
    if (this.#floor(key) > 0) return;
    line[mark] = !line[mark];
    this.#changed();
  }

  /** Toggle the mark a spell takes when it is added to a loadout. Saved at once. */
  static async #markDefault(event, target) {
    const mark = target.dataset.mark;
    if (!MARK_NAMES.includes(mark) || !this.#actor.isOwner) return;
    const row = target.closest("[data-uuid]");

    if (row.dataset.item) {
      const spell = this.#candidates.get(row.dataset.item);
      const item = this.#actor.items.get(row.dataset.item);
      if (spell && item) await setItemMark(item, mark, !spell[mark]);
      return;
    }
    const entry = this.#known.get(row.dataset.uuid);
    // The mark is kept on the list the spell comes from.
    const list = entry?.sourceId ? getSources(this.#actor).find((item) => item.id === entry.sourceId) : this.#list.target;
    if (entry && list) await setEntryMark(list, entry.id, mark, !entry[mark]);
  }

  /** Add a spell staged from outside the favored list to it. §13.13 */
  static async #favor(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!this.#open || !uuid || this.#known.has(uuid)) return;
    await learn(this.#list.target, uuid).catch((err) => console.error(LOG, "adding a favored spell failed", err));
  }

  static #expand(event, target) {
    const row = target.closest("[data-row]");
    const id = row.dataset.row;
    if (closeSummary(row)) return void this.#expanded.delete(id);
    this.#expanded.add(id);
    openSummary(row, { secrets: this.#actor.isOwner });
  }

  static async #view(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid).catch(() => null);
    if (doc) doc.sheet.render(true);
    else ui.notifications.warn("PF1ESB.Source.Missing", { localize: true });
  }

  /** The system's spell browser at one level of this book's class. */
  static #browse(event, target) {
    browseSpells(listTag(this.#actor, this.#bookId), target.closest("[data-level]")?.dataset.level);
  }

  static #toggleLevel(event, target) {
    const section = target.closest(`.${CSS}level`);
    const key = `${section.dataset.side}:${section.dataset.level}`;
    if (!this.#collapsed.delete(key)) this.#collapsed.add(key);
    section.classList.toggle(`${CSS}collapsed`);
  }

  /** Empty the staged loadout. */
  static #clear() {
    if (!this.#plan.size || this.#mode === MODE.fill) return;
    this.#plan = new Map();
    this.#changed();
  }

  /** Drop the preparation set aside for the next rest. */
  static async #discardPending() {
    await clearPending(this.#actor, this.#bookId);
  }

  /** Back to what is on the actor. */
  static #reset() {
    this.#plan = this.#actual();
    this.#dirty = false;
    this.render();
  }

  /** The staged loadout as plan lines. `named` keeps what a profile needs to show them. */
  #lines(named = false) {
    return [...this.#plan.values()].map((line) => {
      const marks = { combat: !!line.combat, quick: !!line.quick };
      const base = line.granted
        ? { itemId: line.itemId, count: line.count, ...marks }
        : {
            uuid: line.uuid,
            slot: line.slot,
            rule: line.rule ?? null,
            cost: line.cost ?? 1,
            marked: !!line.marked,
            meta: line.meta,
            count: line.count,
            ...marks,
          };
      return named ? { ...base, name: line.name } : base;
    });
  }

  static async #apply() {
    if (this.#busy) return;
    if (this.#locked) return void ui.notifications.warn("PF1ESB.Prep.RestOnlyNote", { localize: true });
    this.#busy = true;
    try {
      // Borrowed spells a loadout carried over unchecked are checked first, and the
      // ones that fail are left out. §21.3
      let keep = () => true;
      if (this.#pooled) {
        // Filling leaves what is already memorized as it is.
        const floors = this.#mode === MODE.fill ? this.#actual() : new Map();
        const exempt = new Set();
        for (const [key, line] of this.#plan) {
          if (line.uuid && floors.has(key) && line.count <= floors.get(key).count) exempt.add(line.uuid);
        }
        const borrowed = await resolveBorrowed(this.#actor, this.#bookId, this.#lines(true), { confirm: true, exempt });
        if (borrowed.cancelled) return;
        if (borrowed.dropped.size) {
          ui.notifications.warn(t("PF1ESB.Borrow.Dropped", { count: borrowed.dropped.size }));
          keep = (line) => !line.uuid || !borrowed.dropped.has(line.uuid);
        }
      }

      // Set aside for the rest to apply: nothing on the actor changes yet. §18
      if (this.#mode === MODE.stage) {
        await setPending(this.#actor, this.#bookId, this.#lines(true).filter(keep));
        ui.notifications.info("PF1ESB.Prep.Staged", { localize: true });
        this.#outcome = "staged";
        this.#dirty = false;
        // The choice is made: closing tells whoever is waiting on it.
        await this.close();
        return;
      }

      const result = await setPreparation(this.#actor, this.#bookId, this.#lines().filter(keep));
      await afterApply(this.#actor, this.#bookId, this.#lines(true).filter(keep));
      if (result.missing.length) ui.notifications.warn(t("PF1ESB.Prep.Missing", { count: result.missing.length }));
      ui.notifications.info("PF1ESB.Prep.Applied", { localize: true });
      this.#outcome = "applied";
      this.#dirty = false;
      // Done: the Spells tab now shows the loadout.
      await this.close();
    } catch (err) {
      console.error(LOG, "applying the preparation failed", err);
      ui.notifications.warn("PF1ESB.Prep.Failed", { localize: true });
    } finally {
      this.#busy = false;
    }
  }

  static async #saveProfile() {
    const selected = getProfiles(this.#actor, this.#bookId).find((p) => p.id === this.#profile);
    const current = selected && !selected.previous ? selected.name : "";
    const name = await DialogV2.prompt({
      window: { title: "PF1ESB.Prep.SaveTitle" },
      content: `<div class="form-group"><label>${esc(t("PF1ESB.Prep.ProfileName"))}</label>
        <input type="text" name="name" value="${esc(current)}" autofocus></div>`,
      ok: { label: "PF1ESB.Prep.Save", callback: (event, button) => button.form.elements.name.value.trim() },
      rejectClose: false,
    });
    if (!name) return;
    this.#profile = await saveProfile(this.#actor, this.#bookId, name, this.#lines(true));
    this.render();
  }

  /** Stage a saved loadout. */
  static async #loadProfile() {
    const profile = getProfiles(this.#actor, this.#bookId).find((p) => p.id === this.#profile);
    if (!profile) return;
    const { plan, skipped } = await this.#stage(profile.plan);
    this.#plan = plan;
    if (skipped) ui.notifications.warn(t("PF1ESB.Prep.ProfileSkipped", { count: skipped }));
    this.#changed();
  }

  static async #deleteProfile() {
    const profile = getProfiles(this.#actor, this.#bookId).find((p) => p.id === this.#profile);
    if (!profile || profile.previous) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "PF1ESB.Prep.DeleteTitle" },
      content: `<p>${t("PF1ESB.Prep.DeleteBody", { name: esc(profile.name) })}</p>`,
    });
    if (!confirmed) return;
    this.#profile = "";
    await deleteProfile(this.#actor, this.#bookId, profile.id);
  }

  _onClose(options) {
    super._onClose(options);
    untrack(this);
    windows.delete(`${this.#actor.uuid}:${this.#bookId}`);
    for (const resolve of this.#waiting.splice(0)) resolve(this.#outcome);
  }
}

/**
 * Open the Prepare Spells window for one book, or bring it forward.
 *
 * @param {Actor} actor
 * @param {string} bookId
 * @param {object} [options]
 * @param {string} [options.mode="apply"]  One of `MODE`. §18
 */
export function openPrepare(actor, bookId, { mode = MODE.apply, allow = false } = {}) {
  if (!actor || !bookId) return null;
  const key = `${actor.uuid}:${bookId}`;
  let app = windows.get(key);
  if (!app) {
    app = new PrepareWindow(actor, bookId);
    windows.set(key, app);
  }
  app.setMode(mode);
  app.setAllowed(allow);
  // Spellbooks written before the known list existed are caught up here. §21.3
  syncKnown(actor, bookId).catch((err) => console.error(LOG, "updating known spells failed", err));
  syncRuleOffsets(actor).catch((err) => console.error(LOG, "updating the spells per level failed", err));
  app.render({ force: true }).catch((err) => console.error(LOG, "the Prepare Spells window failed to open", err));
  return app;
}
