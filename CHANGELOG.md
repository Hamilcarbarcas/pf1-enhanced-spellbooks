# Changelog

All notable changes to this module are documented here. Release notes are taken from the section
matching each release tag.

## [Unreleased]

### Added
- **Spellbook** setting on the class feature that grants a class's spellbook through PF1 Enhanced
  Links (or, for a class with spellcasting of its own, in its Spellcasting block): None, Learned
  (spellbook item), or Whole class list. It applies to player characters with that class.
- **Use Enhanced Spellbooks** checkbox on an actor's Settings tab, under Spellbook Usage. Ticked,
  an NPC uses its classes' Spellbook setting; unticked, a player character does not.
- **Spellbooks** inventory section. An item in it holds a list of spells as links to compendium
  entries. A spellbook counts as usable while it is on the character and carried, including
  inside a carried container.
- Spellbook item settings on its Details tab: the class it is written for, its highest spell
  level, its pages, and whether a spell costs one page or one page per spell level.
- **Spells** tab on a spellbook item, listing what it holds by level with its type, spell count,
  and pages used.
- A spellbook on a character opens from a book icon on its inventory row, or from **Open
  Spellbook** on its Spells tab, for a class that can use it.
- **Spellbook item** choice in a class's settings on the Spells tab, naming which item is that
  class's own spellbook.
- Spells tab changes for a class with a Spellbook: an **Open Spellbook** button, spells with
  nothing prepared hidden unless **Show unprepared spells** is ticked in the class's settings, and
  preparation no longer editable on the tab.
- **Spellbook window**: the spellbook item's spells by level in as many columns as fit, with its
  type, spell count, and pages. Spells are added by dropping them in, browsed for by level, shown
  in detail by clicking their names, and removed with a trash icon.
- **Prepare Spells window**: the day's prepared spells beside the spellbook, with slot counts per
  level. Changes are staged and written by **Apply**, which also unprepares every other spell of
  that class on the Spells tab.
- Domain and school slots in the Prepare Spells window, filled from the domain or school spells
  already on the character.
- Combat tab and Quick Actions toggles on every spell row, applied when the spell is prepared.
  A spell that is unprepared leaves both until it is prepared again.
- **Favored Spells** for classes that prepare from their whole class list: a list kept on the
  character in place of a spellbook item. Such a class can also prepare any spell dropped from
  the system's spell browser, opened per level from the Prepare Spells window.
- **Clear** in the Prepare Spells window empties the prepared side.
- In the Prepare Spells window, a spell's name expands its details and an edit icon opens it.
- A spell prepared from outside a favored list can be added to it with the star on its row.
  **Favor spells when prepared**, in the class's spell settings, adds them all on **Apply**.
- **Special slot rules**: named groups of domain or school slots filled from the spellbook by
  school, subschool, or descriptor, or from the spells a feature grants; extra spells for classes
  that prepare each spell once; and a slot cost for spells such as a wizard's opposition schools.
  Edited from a class feature through PF1 Enhanced Links, or by hand from the class's spell
  settings.
- **Substitution**: casting cure, inflict, summon nature's ally, domain, or chosen spells, or
  spells of a school or descriptor, by giving up a different prepared spell, from a lightning
  button beside a spell's uses on the Spells tab. A covered spell stays on the tab when nothing of
  it is prepared. The spell's chat card notes what was given up. Replaces the
  Spontaneous Casting for Pathfinder 1 module.
- **Flexible slots**: a slot rule can leave its slot open, to cast any of its group's spells
  from an entry on the Spells tab, as a shaman's Spirit Magic does.
- **Metamagic**: a feat is switched on as a metamagic in the rule editor, with the slot levels it
  costs. What it does to a spell is a script call in a new **Metamagic** category on the feat.
  Classes that fill slots add metamagic in the Prepare Spells window, which prepares the spell in
  its higher slot. Classes that cast from a pool add it when casting, from an icon on the Spells
  tab.
- A spell a feature grants through PF1 Enhanced Links can be prepared straight from the
  character, in an ordinary slot, and counts as known.
- **Memory**: a spell of a character's own spellbook can be marked as prepared from memory, with
  no spellbook at hand.
- **Known spells**: each class that keeps a spellbook has a list of the spells it knows, filled
  as spells are written into its own spellbooks and editable from its settings on the Spells tab.
- **Borrowed spellbooks**: a spellbook item has an **Owner**. A class prepares the spells it
  knows from spellbooks that are not its own at a Spellcraft check per spell, DC 15 + spell
  level, rolled when the spell is added. Results stay on the spellbook, can be set by hand, and are cleared by **Reset spell
  checks** or the API.
- Spellbook item settings: **Kind** (Book or Familiar), **Owner**, and a GM-only **Empty value**.
  **Pages** and **Page cost** are now GM-only, and a spell that does not fit in the pages left
  can't be added.
- A spellbook item's price is kept current from its empty value and the spells in it.
- **Reads spellbooks of** on a class item: whose spellbooks the class can use. By default wizard,
  arcanist, and magus share, and alchemist and investigator read those and each other's.
- A spell in a spellbook or favored list that is not on the class's own spell list is marked.
- Prepared domain and school spells are listed first in each level of the Spells tab.
- **Profiles**: saved sets of prepared spells that can be loaded into the Prepare Spells window.
  A **Previous** profile always holds the last loadout applied, and the window opens on it.
- World setting **Prepare spells only after a rest**: Apply in the Prepare Spells window works
  only once a rest has offered it.
- The Spells tab has a **Prepare Spells** button beside **Open Spellbook**.
- For a class like the arcanist, special slot rules raise its spells per level on the Spells tab,
  so the sheet's counts agree with the Prepare Spells window.
- For a class that knows a set number of spells, each level's heading on the Spells tab shows how
  many it knows against how many it may.
- With more than one spellbook on a character, the Spellbook window's name and the Prepare Spells
  window's right-hand heading become dropdowns of them, each marked as yours or borrowed.
- The Spellbook window shows a heading for every spell level, greying the ones the class can't
  cast yet.
- After a rest from the character sheet, a chat card offers the Prepare Spells window for each
  class the module handles, and checks on borrowed spellbooks are cleared.
- Preparing around a rest, through the API: choose a preparation now and apply it when the rest
  ends, or open the Prepare Spells window to fill open slots only.
- API at `game.modules.get("pf1-enhanced-spellbooks").api` for reading a book's settings and
  slots, adding and removing spells in a spellbook item, reading and setting a book's prepared
  spells, and opening both windows.
