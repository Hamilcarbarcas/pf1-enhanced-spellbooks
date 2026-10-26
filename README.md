# PF1 Enhanced Spellbooks

Separates what a Pathfinder 1e caster can cast right now from where that is decided.

**Manifest URL:** `https://github.com/Hamilcarbarcas/pf1-enhanced-spellbooks/releases/latest/download/module.json`

## Requirements
- Foundry VTT v13
- PF1e system v11.10

## Contents

- [Status](#status)
- [Recommended modules](#recommended-modules)
- [Setup](#setup)
  - [Giving a class a Spellbook](#giving-a-class-a-spellbook)
  - [Spellbook items](#spellbook-items)
- [The Spells tab](#the-spells-tab)
- [The Spellbook window](#the-spellbook-window)
- [Favored spells](#favored-spells)
- [Preparing spells](#preparing-spells)
  - [Domain and school spells](#domain-and-school-spells)
  - [Special slot rules](#special-slot-rules)
  - [Flexible slots](#flexible-slots)
  - [Substitution](#substitution)
  - [Metamagic](#metamagic)
  - [Memory and borrowed spellbooks](#memory-and-borrowed-spellbooks)
  - [Combat tab and Quick Actions](#combat-tab-and-quick-actions)
  - [Profiles](#profiles)
  - [After a rest](#after-a-rest)
  - [Preparing only after a rest](#preparing-only-after-a-rest)
- [For other modules](#for-other-modules)
  - [Preparing around a rest](#preparing-around-a-rest)
  - [Borrowed spellbook checks](#borrowed-spellbook-checks)
  - [Metamagic calls](#metamagic-calls)

## Status

Early development. Classes that record spells in a spellbook item and classes that prepare from
their whole class list are both supported, with named special slots, spells that cost extra, and
casting by substitution, slots whose spell is chosen at casting, metamagic, and preparing from
memory or a borrowed spellbook. A spellbook item's price follows the spells in it.

## Recommended modules

- **[PF1 Enhanced Links](https://github.com/Hamilcarbarcas/pf1-enhanced-links)**: lets class
  features grant spells, change a spellbook's settings, and read another class's spell list.

## Setup

### Giving a class a Spellbook

Open the class feature that grants the class's spellbook (**Grant a spellbook** in PF1 Enhanced
Links' Spellcasting section). Below the book's settings, set **Spellbook**:

- **None**: the class works as it does without this module.
- **Learned (spellbook item)**: the character prepares from the spells recorded in a spellbook
  item they carry, like a wizard.
- **Whole class list**: the character prepares from every spell on the class's list, like a
  cleric, and keeps a list of [favored spells](#favored-spells) for quick picking.

The setting applies to player characters with that class. NPCs keep the system's normal
spellcasting unless **Use Enhanced Spellbooks** is ticked under **Spellbook Usage** on the actor's
**Settings** tab. Unticking it on a player character turns the module off for them the same way.

A class that still has spellcasting of its own shows **Spellbook** in its **Spellcasting** block
instead, for books no feature grants.

A class set to **Learned** also has **Reads spellbooks of**: the class tags whose spellbooks it
can use, separated by commas. Left blank, it uses these defaults:

| Class | Reads the spellbooks of |
|---|---|
| Wizard, arcanist, magus | Wizard, arcanist, magus |
| Alchemist, investigator | Alchemist, investigator, wizard, arcanist, magus |
| Any other | Its own |

### Spellbook items

The module adds a **Spellbooks** section to the inventory. An item in it holds a list of spells as
links to compendium entries, so the list travels with the item when it is traded or put in a
container.

A spellbook can be used while it is on the character and carried. Inside a container, it counts
as carried when the container is.

The item's **Details** tab has a **Spellbook** section with its settings:

| Setting | Meaning |
|---|---|
| **Kind** | **Book** or **Familiar**. A familiar has no pages and no price to keep. |
| **Owner** | The character this belongs to. Type a name, or press the button beside it to name the character carrying it. Leave it blank for a class's own spellbook. See [Memory and borrowed spellbooks](#memory-and-borrowed-spellbooks). |
| **Class** | The class tag the book is written for, such as `wizard`. Only classes that read that class's spellbooks can use it. Blank lets any class use it. |
| **Highest spell level** | The Spellbook window shows a heading for every level up to this one. |
| **Pages** | GM only. How many pages the book has. Blank for no limit. A spell that does not fit can't be added. |
| **Page cost** | GM only. **Standard** is one page per spell level (a cantrip takes one). The other choice is one page per spell. |
| **Empty value (gp)** | GM only. What the book costs with no spells in it. |

The module keeps a book's **price** current: its empty value, plus 5 gp for each cantrip, plus
spell level × 10 × the pages it takes for every other spell. The first time it works this out,
it takes the price the item already has as its empty value, so check that field on a spellbook
that was priced by hand.

The item's **Spells** tab lists what the book holds, level by level, with its type, spell count,
and pages used.

A spellbook on a character can be opened from the book icon on its inventory row, or from **Open
Spellbook** on its Spells tab. Either opens the book for the character's class. If more than one
of their classes can use the book, it asks which.

Choose which item is a class's own spellbook with **Spellbook item**, in that class's settings on
the Spells tab (the gears). An item opened from its own sheet can also be made the class's
spellbook from the window.

## The Spells tab

For a class with a Spellbook, the Spells tab shows only what is prepared:

- Two buttons sit at the top of the class's spell list: **Open Spellbook** and **Prepare
  Spells**.
- Spells with nothing prepared are hidden. **Show unprepared spells**, in the class's settings
  (the gears), brings them back dimmed, so leftover spells can be removed.
- Preparation can't be changed on the tab. Uses left still can.

For a class that knows a set number of spells, such as a sorcerer or inquisitor, every level's
heading shows how many it knows against how many it may: **Known: 5/4**. For a class that
prepares each spell once, like the arcanist, it shows **Prepared: 5/5** instead. This is on any
such class, whether or not the module handles its spells.

## The Spellbook window

**Open Spellbook** shows what the class's spellbook item holds, grouped by spell level, with the
book's type, how many spells it has, and its pages. The levels flow into as many columns as the
window is wide enough for.

- **Add a spell** by dropping it on the window. **Browse spells** opens the system's spell
  browser to drag from, and the browse icon on a level's heading opens it at that level. Spells
  must come from a compendium or the Items directory.
- **Click a spell's name** to show its details under it.
- A spell that is not on the class's own spell list is shown in italics with a warning icon. It
  can still be prepared.
- **Open a spell** in its own window with the edit icon, or **remove it** with the trash icon.
- **Prepare Spells** opens the preparation window.

Every spell level has a heading. A level the class can't cast yet is greyed, and its spells
carry a warning icon.

When the character has more than one spellbook the class can read, the name at the top is a
dropdown of them, each marked as yours, borrowed, or not carried.

## Favored spells

A class set to **Whole class list** has no spellbook item. Its button on the Spells tab reads
**Favored Spells**, and opens the same window on a list the character keeps of the spells they
use most. Add as many as you like, the same ways as for a spellbook. The list has no pages and
is never unavailable.

Favored spells are a convenience, not a limit. In the Prepare Spells window such a class can
also prepare any spell straight from the system's spell browser:

- The browse icon on each level of the prepared side opens the browser at that level.
- Drop a spell on the prepared side to prepare it, or on the favored side to add it to the list.
- A spell that is not on the class's list can still be prepared, with a warning.
- A prepared spell that is not in the favored list has a star on its row, which adds it.
- Tick **Favor spells when prepared**, in the class's settings on the Spells tab (the gears), to
  have **Apply** add every spell prepared from outside the favored list to it.

## Preparing spells

The **Prepare Spells** window has the day's prepared spells on the left and the spellbook on the
right. Both sides are grouped by spell level, and each level can be collapsed. Widening the window
gives the extra room to the spellbook, which flows into more columns.

- **Add a spell** with the plus on its row, or drag it to the left side.
- **Click a spell's name** on either side to show its details under it. The edit icon opens the
  spell in its own window.
- **Change how many times it is prepared** with the minus and plus, or type a number. A class that
  prepares each spell once, like the arcanist, has no count.
- Each level shows how many slots are used out of how many the character has. Going over is
  marked, not prevented.
- Nothing changes on the character until **Apply**. **Clear** empties the prepared side, and
  **Reset** returns it to what the character has prepared now.

**Apply** closes the window and makes the left side the whole of what the class has prepared. Any other spell of that
class on the Spells tab becomes unprepared, including spells that were prepared there by hand, and
leaves the Combat tab and Quick Actions until it is prepared again.
On the Spells tab, domain and school spells are listed first in each level, then the rest by name.

If the spellbook item is not carried, nothing can be added from it.

### Domain and school spells

A class with domain or school slots has a **Domain Spells** or **School Spells** group at the top
of each level. On the right it lists the domain or school spells already on the character's Spells
tab, which are the only spells that can fill those slots. On the left it shows the ones chosen and
how many of the slots they use.

### Special slot rules

A slot rule gives a group of special slots a name and says what fills it, or makes certain spells
cost more. Rules are edited in two places:

- **On a class feature**, with PF1 Enhanced Links active: **Edit rules** in the feature's
  Spellcasting section. The rules apply to the feature's class while the character has it.
- **By hand**, for one character: **Slots and substitution** in the class's settings on the
  Spells tab (the gears).

| Field | Meaning |
|---|---|
| **Name** | What the group is called in the Prepare Spells window, such as Evocation School. |
| **Filled by domain or school spells on the character** | The group takes domain or school spells that are on the Spells tab. On a feature that grants such spells itself, it takes those. On any other feature, or entered by hand, it takes the ones other features grant. Leave unticked to fill the group from the spellbook by the traits below. |
| **Chosen when cast** | Only with the box above ticked. The slot is left open, and any of the group's spells can be cast from it. See [Flexible slots](#flexible-slots). |
| **Spell School**, **Subschool**, **Descriptor** | Which spells fit. Every kind you fill in must fit, and one match within a kind is enough. A descriptor also fits a spell whose descriptor lists it among others, such as "air, earth, fire, or water". |
| **Descriptor contains** | Text a descriptor must contain, for descriptors that are not in the list. Counts with **Descriptor** as one kind. |
| **Slots per level** | Special slots the group has at each spell level. |
| **Extra spells** | For a class that prepares each spell once, like the arcanist: extra spells per level that must fit the rule. |
| **Slot cost** | Slots a fitting spell takes in an ordinary slot. Set 2 for a wizard's opposition schools. |

In the Prepare Spells window each group has its own heading and count on the left. On the right,
its spells lead their level under the same heading, and their plus prepares them in that group. A
spell that fits can still be prepared in an ordinary slot from the list below.

A spell that costs extra shows its cost, and counts that many against the level.

So a cleric's domains can be set up as written: each domain feature grants its spells, and the
Domains feature carries one rule, ticked as filled by spells on the character, with one slot per
level. Both domains' spells then share that one group.

For a class that prepares each spell once, like the arcanist, the module raises the class's
spells per level on the Spells tab by what the rules add, shown as `1[Spell rules]` in each
level's prepared offset. For any other class, rules do not change how many special slots it has:
set **Domain/School Slots**, in the same settings or on the feature, to the total the rules give.
Slots no rule claims stay in the plain Domain Spells or School Spells group.

### Flexible slots

Some special slots are not filled in advance: a shaman's Spirit Magic slot can cast any spell her
spirits grant, chosen at the moment of casting. Tick **Chosen when cast** on the slot rule for
those.

Such a slot appears on the Spells tab as an entry of its own at each spell level, named after the
rule and showing its uses. Its wand button asks which of the group's spells to cast, of that
level or lower. The slot is spent only if the cast goes through, and the spell's chat card notes
which slot it came from.

The group's own spells are not prepared and do not appear on the Spells tab. In the Prepare
Spells window the group shows its slot count and "Chosen when cast".

### Substitution

Some classes can cast certain spells by giving up a different prepared spell: a cleric's cure
spells, a druid's *summon nature's ally*. A substitution rule says which spells. Rules are edited
in the same window as special slot rules, under **Substitution**.

| Field | Meaning |
|---|---|
| **Name** | A label for the rule. |
| **Spells** | Cure spells, inflict spells, or summon nature's ally spells, by name; spells whose name contains some text; spells by school, subschool, or descriptor; the domain or school spells on the character; or specific spells dropped onto the rule. |
| **Domain and school spells may be given up** | Without this, a domain or school spell can't be the one given up. |

A spell the rule covers shows a lightning button on the Spells tab, beside its uses, where the
Domain/School mark goes. Clicking it asks which prepared spell to give up: one of the same level
or higher, not a 0-level spell, with a use left. Backing out of that prompt, or of the cast
itself, spends nothing. The spell's chat card notes what was given up, in its footnotes.

A covered spell that isn't prepared still appears on the Spells tab, with only the lightning
button. For that it has to be in the character's spellbook or favored spells, be named in the
rule, or be granted by a feature. Domain and school spells on the character appear when a rule
covers them.

To show every cure spell at each level a cleric can cast, put them all in the Spontaneous Casting
feature's **Spell Supplements** (PF1 Enhanced Links) with **Level gating** off and **Require
castable level** on, and give the same feature a **Cure** rule.

Only classes that fill slots cast this way. Turn off the *Spontaneous Casting for Pathfinder 1*
module if you use it: this replaces it.

### Metamagic

No metamagic feat comes set up. Each one needs two things on the feat itself.

**Its slot cost**, in the rule editor: with **PF1 Enhanced Links** active, open the feat, go to
its Spellcasting section, and press **Edit rules**. Tick **This feat is a metamagic** and fill in:

| Setting | What it does |
|---|---|
| **Name before the spell** | Goes in front of the spell's name. Blank uses the feat's name without "Spell". |
| **Slot levels** | How much higher a slot the spell takes. |
| **Caster chooses** | The caster picks the number of levels each time, as with Heighten Spell. |
| **Raises the spell's level** | The spell's own level rises with its slot, so its save DC does too. |

**What it does to the spell**, as a script: on the feat's Advanced tab, add a script call in the
**Metamagic** category. The script is handed `spell` (the spell's data, to change), `levels`
(the slot levels this metamagic adds), `spontaneous` (true when applied at casting), and
`meta`, a set of helpers:

| Helper | Effect |
|---|---|
| `meta.duration(spell, 2)` | Multiplies the duration. |
| `meta.range(spell, 2)`, `meta.rangeSteps(spell, 1)` | Multiplies the range, or moves it up: touch, close, medium, long. |
| `meta.area(spell, 2)` | Multiplies the size of the spell's template. |
| `meta.damage(spell, 1.5)` | Multiplies damage, rounded down. |
| `meta.damageFormula(spell, (formula) => ...)` | Rewrites each damage formula. |
| `meta.removeComponents(spell, "verbal")` | Drops verbal, somatic, or material components. |
| `meta.activation(spell, "swift")` | Sets the casting time. |
| `meta.note(spell, "text")` | Adds a line to the spell's footnotes. |

Extend Spell, for example, is one slot level and the script `meta.duration(spell, 2);`.

A character has every metamagic whose feat is on their sheet.

**Classes that fill slots** apply metamagic when preparing. In the Prepare Spells window, the
up-arrows icon on a spellbook row asks which metamagics to add and says what slot the spell will
take. The spell is prepared in that slot, with its metamagics listed under its name, and appears
on the Spells tab under its new name. Its save DC stays that of its own level unless a metamagic
raises it.

**Classes that cast from a pool** apply metamagic when casting. The up-arrows icon on a spell's
row on the Spells tab asks which metamagics to add, and says which level of cast it uses and how
many are left. A standard-action spell becomes a full-round action. Classes that do both, such as
the arcanist, have both.

Changing a metamagic's settings or script does not change spells already prepared with it. Take the spell
out, **Apply**, and add it again.

### Memory and borrowed spellbooks

A class that keeps a spellbook item prepares from every spellbook it can read that is on the
character and carried, and from what it holds in memory.

**Granted spells.** A spell that a feature puts on the character through PF1 Enhanced Links,
such as a witch's patron spell, is listed in the Prepare Spells window with a gift icon and is
prepared straight from the character, with no spellbook. It also counts as known.

**Memory.** In the Spellbook window, the brain icon on a spell of the character's own spellbook
marks it as one they can prepare with no spellbook at hand. Use it for *read magic* and for
Spell Mastery.

**Whose a spellbook is.** A spellbook is the character's own when its **Owner** setting names
them, or when Owner is blank and it is the class's chosen **Spellbook item**. Any other
spellbook they carry and can read is borrowed. The owner is remembered by name and by the
character behind it, so it survives a rename, and survives a copy of the character taking over
under the same name.

**Known spells.** Each class keeps its own list of the spells it knows. A spell written into one
of that class's own spellbooks is added to it, and stays on it if the spellbook is lost or the
spell is taken out. Edit the list by hand with **Known spells**, in the class's settings on the
Spells tab (the gears): drop spells in, browse for them, or remove them with the trash icon. A
spell still written in one of the class's own spellbooks can't be removed, and shows which
spellbook holds it.

A spellbook is a character's own for the class named in its **Class** setting. For any other
class of theirs it counts as borrowed, and so does a spellbook with no Class set, unless that
class has chosen it as its **Spellbook item**. So set Class on any spellbook you name an owner
for.

**More than one spellbook.** A loadout can draw on every spellbook at once. The right side's
heading names the spellbook and whether it is yours or borrowed. With more than one thing to
choose from, it is a dropdown that narrows the list: **Everything**, one spellbook, or **Without
a spellbook**, which shows only the spells held in memory and the spells a feature grants.

**Borrowed spellbooks.** Their spells are listed with the rest in the Prepare Spells window,
with a book icon. A borrowed spellbook can only be used for spells the class knows; the others
are greyed out with a question icon. A known one has a d20 button in place of its plus: it rolls
a Spellcraft check, DC 15 + the spell's level, as the character's own roll with the usual dialog.
Its chat card is shown only to the character's owners and the GM.

- **Passed:** a green tick appears and the plus with it. The spell needs no further check,
  however many times it is prepared.
- **Failed:** the spell is greyed out with a red icon and can't be prepared from that spellbook.
- **Dialog closed:** nothing happens.

A GM can reverse a result by right-clicking its icon.

A loadout loaded from a profile can hold borrowed spells that have not been checked yet.
**Apply** lists those and asks before rolling them.

Results stay on the spellbook until they are reset. Open the borrowed spellbook to see them:
each spell has a check icon, and clicking one that failed or was never checked marks it passed
(clicking a passed one clears it). **Reset spell checks**, shown only on a spellbook that is not
the character's own, clears them all. Resting from the character sheet resets them too. A rest
manager that does not use the system's rest has to do it itself; see
[For other modules](#for-other-modules).

### Combat tab and Quick Actions

Every spell row has two small toggles, orange when on:

- **Sword**: show the spell on the character's Combat tab.
- **Bolt**: show the spell in the character's Quick Actions.

These are the same two settings found on a spell's own sheet. On a prepared spell (the left
side), a toggle applies to that loadout only, and is saved with a profile. On the right side and
in the Spellbook window, a toggle sets what the spell starts with whenever it is added to a
loadout.

### Profiles

A profile is a saved set of prepared spells. **Save** stores the current left side under a name,
**Load** brings a profile back, and **Delete** removes it. Loading a profile changes nothing on the
character until **Apply**.

**Previous** is a profile the module keeps itself: the last loadout applied, replaced on every
**Apply**. The window opens on it.

### After a rest

When a character rests from their sheet and daily uses are restored, the module posts a chat
card to the character's owners with a **Prepare Spells** button for each class it handles. The
button opens the Prepare Spells window; **Apply** there sets the day's spells. Ignoring the card
keeps yesterday's spells, refilled. The rest also clears the character's checks on borrowed
spellbooks.

### Preparing only after a rest

The world setting **Prepare spells only after a rest** turns **Apply** off in the Prepare Spells
window until a rest has offered that class its preparation. Resting from the character sheet
does that, and so does a rest manager that uses this module. The offer is used up by the next
loadout applied. Loadouts can still be planned and saved as profiles at any time, and a GM can
always apply.

## For other modules

The API is at `game.modules.get("pf1-enhanced-spellbooks").api`. A book is named by its id on the
actor, such as `primary`. `getManagedBooks(actor)` lists the ones this module handles.

### Preparing around a rest

A preparation can be chosen while a rest is running and applied when it ends.

| Call | What it does |
|---|---|
| `stagePreparation(actor, bookId)` | Opens the Prepare Spells window to choose now and apply later. Its button reads **Set for rest**. Nothing on the character changes. |
| `applyPending(actor, bookId)` | Puts the choice set aside onto the character. Leave out `bookId` to do every class that has one. Call it before the rest restores spell uses. |
| `fillPreparation(actor, bookId)` | Opens the window to fill open slots only. Spells already prepared can gain preparations, but can't be reduced, removed, or changed. |
| `getPending(actor, bookId)`, `clearPending(actor, bookId)`, `pendingBooks(actor)` | Read or drop the choice set aside. |
| `grantPreparation(actor, bookId)` | With **Prepare spells only after a rest** on: lets the class apply one loadout from the ordinary window. Leave out `bookId` for every class. |

The two calls that open a window return a promise. It resolves when the window closes, with
`"staged"`, `"applied"`, or `null` if nothing was applied.

A preparation may leave slots unfilled. A character with a choice waiting sees a note about it in
the ordinary Prepare Spells window, with a link to discard it.

### Borrowed spellbook checks

| Call | What it does |
|---|---|
| `resetChecks(actor)` | Clears the character's Spellcraft results on every spellbook they carry. Call it when a new day starts. |
| `resetChecks(actor, item)` | The same for one spellbook. |
| `getChecks(item, actor)`, `setCheck(item, actor, entryId, value)` | Read or set results. `value` is `"pass"`, `"fail"`, or `null` to clear. |
| `syncValue(item)` | Works out a spellbook item's price from its spells now. |
| `knownList(actor, bookId)`, `knownIndex(actor, bookId)`, `syncKnown(actor)`, `openKnown(actor, bookId)` | A class's known spells: the stored list, a lookup that also counts its own spellbooks, a catch-up from those spellbooks, and the window that edits the list. |

### Metamagic calls

| Call | What it does |
|---|---|
| `getMetamagics(actor)` | The metamagics the character has, each with its settings and the key that names it. |
| `readMetamagic(item)`, `saveMetamagic(item, settings)` | Read or write a feat's metamagic settings. |
| `metamagic` | The helpers a metamagic script gets as `meta`. |
| `await applyMetamagic(data, list, metamagics, options)` | Changes a spell's item data in place, running each feat's Metamagic script calls. `list` holds keys from `getMetamagics`, with `key:n` for one whose levels are chosen. Pass `{ spontaneous: true }` for metamagic added at casting. |
| `castWithMetamagic(actor, item)` | Asks which metamagics to add, casts the spell with them, and takes the cast from the higher level. For classes that cast from a pool. |
