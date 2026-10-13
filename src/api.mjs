/**
 * Public API. DESIGN.md §13.6, §13.9, §13.12, §14. Exposed as
 * `game.modules.get("pf1-enhanced-spellbooks").api` and `game.pf1EnhancedSpellbooks`.
 */

import {
  deleteProfile,
  getConfig,
  getManagedBooks,
  getProfiles,
  getSlots,
  savePrevious,
  saveProfile,
} from "./books.mjs";
import {
  eligibleBooks,
  favoredList,
  forget,
  getBookList,
  getEntries,
  getPrimary,
  getSourceConfig,
  getSources,
  isAvailable,
  learn,
  setEntryMark,
  setPrimary,
  setSourceConfig,
} from "./sources.mjs";
import {
  getPreparation,
  getSpecialCandidates,
  getGrantedSpells,
  getActorSpells,
  setItemMark,
  setPreparation,
  syncSubstitutions,
} from "./prepare.mjs";
import { openFromItem, openSpellbook } from "./apps/spellbook-window.mjs";
import { MODE, openPrepare } from "./apps/prepare-window.mjs";
import { grantPreparation } from "./rest.mjs";
import { applyPending, clearPending, getPending, pendingBooks, setPending } from "./pending.mjs";
import { openRules } from "./apps/rules-window.mjs";
import { getGroups, getRules, getSubs, readRules, readSubs, ruleList, subList } from "./rules.mjs";
import { castBySubstitution, castFlexible, flexOptions, sacrificeOptions } from "./substitute.mjs";
import { applyMetamagic, castWithMetamagic, getMetamagics, helpers, readMetamagic, saveMetamagic } from "./metamagic.mjs";
import {
  borrowedSources,
  getChecks,
  getPool,
  isBorrowed,
  isOwn,
  knownIndex,
  knownList,
  memoryList,
  resetChecks,
  resolveBorrowed,
  setCheck,
  setOwner,
  syncKnown,
} from "./borrow.mjs";
import { openKnown } from "./apps/spellbook-window.mjs";
import { syncValue } from "./sources.mjs";

/** What a substitution with no name of its own is called: its kind. */
const SUB_KIND_LABELS = {
  cure: "PF1ESB.Sub.Kind.Cure",
  inflict: "PF1ESB.Sub.Kind.Inflict",
  sna: "PF1ESB.Sub.Kind.Sna",
  domain: "PF1ESB.Sub.Kind.Domain",
  name: "PF1ESB.Sub.Kind.Name",
  spells: "PF1ESB.Sub.Kind.Spells",
  traits: "PF1ESB.Sub.Kind.Traits",
};

export const api = {
  getConfig,
  getManagedBooks,
  getSlots,

  /** Source items on an actor, each with whether it can be prepared from right now. */
  getSources: (actor) => getSources(actor).map((item) => ({ item, available: isAvailable(item) })),
  getSourceConfig,
  setSourceConfig,
  eligibleBooks,
  getBookList,
  favoredList,
  getPrimary,
  setPrimary,
  getEntries,
  learn,
  forget,
  setEntryMark,
  setItemMark,

  getPreparation,
  getSpecialCandidates,
  getGrantedSpells,
  getActorSpells,
  setPreparation,

  getProfiles,
  saveProfile,
  savePrevious,
  deleteProfile,

  /** Slot rules that apply to a book, and the groups of special slots they make. */
  getRules,
  getGroups,
  /** The rules stored on one feature item: slot rules, then substitution rules. */
  getItemRules: (item) => [
    ...readRules(ruleList(item)),
    ...readSubs(subList(item)),
    ...(readMetamagic(item).enabled ? [readMetamagic(item)] : []),
  ],

  /** An item's rules by name, for showing where the full editor isn't: its metamagic, slot rules, and substitutions. */
  getItemRuleNames: (item) => {
    const names = [];
    if (readMetamagic(item).enabled) names.push(game.i18n.localize("PF1ESB.Meta.Title"));
    for (const rule of readRules(ruleList(item))) names.push(rule.name || game.i18n.localize("PF1ESB.Rules.UnnamedSlot"));
    for (const sub of readSubs(subList(item))) {
      names.push(sub.name || game.i18n.localize(SUB_KIND_LABELS[sub.kind] ?? "PF1ESB.Rules.Unnamed"));
    }
    return names;
  },

  /**
   * Metamagic. §20
   * - `getMetamagics(actor)`: what the actor has.
   * - `applyMetamagic(data, list, metamagics, options)`: change a spell's data in place.
   * - `castWithMetamagic(actor, item)`: the cast-time prompt and cast, for books that cast
   *   from a pool.
   */
  /**
   * Memory and borrowed spellbooks. §21
   * - `getPool(actor, bookId)`: everything the book can prepare now, and from where.
   * - `isOwn` / `isBorrowed(actor, bookId, item)`: whose a spellbook is.
   * - `getChecks(item, actor)`, `setCheck(item, actor, entryId, value)`: a reader's
   *   Spellcraft results on a borrowed spellbook's spells.
   * - `resetChecks(actor, item?)`: forget them, on one spellbook or on all the actor
   *   carries. A rest manager calls this when a new day starts.
   * - `resolveBorrowed(actor, bookId, plan, options)`: roll the checks a plan still needs.
   */
  getPool,
  isOwn,
  isBorrowed,
  setOwner,
  /**
   * Known spells: what a borrowed spellbook may serve. `knownList(actor, bookId)` is the
   * stored list, for `getEntries`, `learn`, and `forget`. `knownIndex` adds what the
   * book's own spellbooks hold. `syncKnown(actor)` copies those into the stored list.
   */
  knownList,
  knownIndex,
  syncKnown,
  openKnown,
  borrowedSources,
  getChecks,
  setCheck,
  resetChecks,
  resolveBorrowed,
  memoryList,
  /** Bring a spellbook item's price in line with its spells. §23 */
  syncValue,

  /** What a metamagic script is handed as `meta`: helpers that change a spell's data. §20.2 */
  metamagic: helpers,
  getMetamagics,
  readMetamagic,
  saveMetamagic,
  applyMetamagic,
  castWithMetamagic,

  /** Substitution: the rules for a book, what may be given up for a spell, and the cast. §15 */
  getSubs,
  sacrificeOptions,
  castBySubstitution,
  syncSubstitutions,

  /** Flexible slots: what can be cast from one, and the cast. §17 */
  flexOptions,
  castFlexible,

  /**
   * Preparation around a rest. §18
   * - `stagePreparation` opens the window to choose now and apply later.
   * - `fillPreparation` opens it to fill open slots, leaving memorized spells alone.
   * - `applyPending` puts the choices set aside onto the actor. Call it before the rest
   *   restores uses.
   * The two that open a window resolve when it closes, with "staged", "applied", or null.
   */
  stagePreparation: (actor, bookId) => openPrepare(actor, bookId, { mode: MODE.stage })?.whenDone() ?? null,
  fillPreparation: (actor, bookId) => openPrepare(actor, bookId, { mode: MODE.fill, allow: true })?.whenDone() ?? null,
  /**
   * For a world that prepares only after a rest: let an actor's books be prepared once
   * from the ordinary window. The system's own rest does this itself. §25
   */
  grantPreparation,
  getPending,
  setPending,
  clearPending,
  pendingBooks,
  applyPending,

  open: openSpellbook,
  openFromItem,
  openPrepare,
  openRules,
};
