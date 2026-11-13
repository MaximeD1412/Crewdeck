---
name: Passerelle
colors:
  ground: '#0d1317'
  panel: '#141c22'
  raised: '#1a242b'
  sunk: '#1e2830'
  side: '#0a0f12'
  ink: '#e4ebef'
  ink-2: '#c3cfd6'
  muted: '#8fa2ad'
  line: '#26323b'
  line-strong: '#34434d'
  control-border: '#5a6b77'
  accent: '#5cc8dc'
  accent-ink: '#04222a'
  accent-hover: '#7ad6e7'
  accent-pressed: '#47b3c7'
  accent-soft: '#123540'
  accent-text: '#7ad6e7'
  go: '#4cc38a'
  go-soft: '#13342a'
  caution: '#f0b44c'
  caution-soft: '#3a2d12'
  halt: '#f2756e'
  halt-soft: '#3f1e1d'
  halt-ink: '#2a0b0a'
  add: '#15301f'
  del: '#3a1b1b'
  scrim: '#05080acc'
  shadow: '#00000080'
  type-idee: '#e2d36a'
  type-prd: '#74a6f4'
  type-maquettes: '#e48ee6'
  type-conception: '#a596f7'
  type-inventaire: '#79d6b9'
  type-ticket: '#63cf8c'
  type-changement: '#f08fb2'
  type-verdict: '#ccd6dc'
  type-livraison: '#b2d46a'
typography:
  brand:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.08em
  page-title:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: 0.01em
  section-label:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.12em
  title:
    fontFamily: IBM Plex Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body:
    fontFamily: IBM Plex Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  caption:
    fontFamily: IBM Plex Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  meta:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  mono:
    fontFamily: IBM Plex Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  stat:
    fontFamily: IBM Plex Sans Condensed
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.125rem
  DEFAULT: 0.1875rem
  lg: 0.25rem
  full: 9999px
spacing:
  space-1: 0.25rem
  space-2: 0.5rem
  space-3: 0.75rem
  space-4: 1rem
  space-5: 1.25rem
  space-6: 1.5rem
  space-8: 2rem
  space-10: 2.5rem
  stroke: 0.125rem
  rail: 0.25rem
  dot: 0.5rem
  bar: 0.375rem
  icon-sm: 1rem
  icon: 1.25rem
  icon-box: 1.75rem
  control-sm: 2.125rem
  control: 2.5rem
  touch: 2.75rem
  header-height: 3.5rem
  tab-bar: 4rem
  sidebar-width: 15rem
  sidebar-compact: 4rem
  step-card: 11rem
  gate-card: 8rem
  port-row: 1.25rem
  menu-width: 18rem
  aside-width: 20rem
  panel-width: 36rem
  dialog-width: 30rem
  doc-column: 45rem
  page-max: 75rem
  text-area: 6rem
  capture-w: 12rem
  capture-w-lg: 22rem
  chart-height: 10rem
---

# Passerelle: Crewdeck's default Skin

The mockups are code (`"tool": "code"` in `screens.json`): `tokens.css` and
`tokens.json` generated from this file's front matter (`design tokens
--write`), the library in `components.js` (one custom element `ui-<name>`
per component of the catalog below, in light DOM, its root carrying
`data-name="<Component>/<Variant>"`) styled by `components.css`, the gallery
`components.html`, one page per screen and state in `screens/crewdeck/`, and
the board `index.html`. The implementation never imports them: it builds
each **Composant** in its own stack and takes `tokens.css`'s values into its
theme.

Every library component here is a **Composant** of the product (US-23): a
**Skin** may replace it. The names below are the ones the Composants'
contracts will use.

## Brand & Style

- A bridge at night: the place where a solo developer watches their crew of
  agents work, dense and calm, read at a glance on the PC and the phone.
- Dark only at the MVP (a light **Thème** is US-22, in the Bêta). One accent,
  cyan, for the action that moves things forward and for what is live; state
  is carried by small signals (a left rail, a dot, a tinted icon box, a
  status badge), never by large coloured surfaces.
- Signage-like condensed titles (IBM Plex Sans Condensed), section labels in
  spaced capitals, machine facts (numbers, branches, times, models) in IBM
  Plex Mono.
- Never: gradients, illustrations, glow, colored page backgrounds, rounded
  pills larger than a chip, more than one primary button per group.
- What sets it apart from the console it replaces (« Poste »): dark,
  tighter radii (2 to 4 px), mono metadata, spaced section labels.

## Colors

| Role | Token |
|---|---|
| Page canvas | `ground` |
| Navigation (sidebar, phone header and tab bar) | `side` |
| Cards, lists, panels | `panel` |
| Hover rows, dialogs, menus | `raised` |
| Plain buttons, inset areas, bars' tracks, code | `sunk` |
| Text, secondary text, metadata | `ink`, `ink-2`, `muted` |
| Separators, card and chip borders | `line`, `line-strong` |
| Form controls' borders (fields, checkboxes, radios, switches, options): 3:1 on `panel` and `side` | `control-border` |
| Primary action, live state, current step, focus ring | `accent` (`accent-ink` on it, `accent-hover`, `accent-pressed`) |
| Accent text and icons on dark surfaces | `accent-text`, on `accent-soft` |
| Done, online, passed | `go` on `go-soft` |
| Waits, limit near, interrupted, incomplete | `caution` on `caution-soft` |
| Blocked, failed, offline, destructive | `halt` on `halt-soft` (`halt-ink` on a `halt` badge) |
| Diff lines | `add`, `del` |
| Canvas: its ground; an arrow and its two dots take the colour of their **Type d'artefact** (the others dim while an **Étape** is selected; `caution` dashed for a **Retour** or a **Manque**, `halt` dashed for a refused one) | `side`, `type-idee`, `type-prd`, `type-maquettes`, `type-conception`, `type-inventaire`, `type-ticket`, `type-changement`, `type-verdict`, `type-livraison` |
| Dialog backdrop, shadows | `scrim`, `shadow` |

Contrast: every text colour is AA on `ground`, `side`, `panel`, `raised`,
`sunk` and `accent-soft` (the lowest, `muted` on `accent-soft`, is 4.9:1);
`accent-ink` on `accent` is 8.6:1; `control-border` is 3:1 on `panel`.
Never lower a text's opacity to show a stale state: dim the surface, keep the
text colours.

## Typography

| Level | Use |
|---|---|
| `brand` | the product's name in the **Cadre**, capitals |
| `page-title` | one per page |
| `section-label` | a card's or list's heading, capitals, `muted` |
| `title` | a row's title (a **Décision**, an **Idée**, a **Ticket**) |
| `body`, `body-sm` | text, a row's context |
| `label` | buttons, form labels, navigation |
| `caption` | badges, tab bar labels, field help |
| `meta` | a row's metadata line (Projet · Étape · time), numbers |
| `mono` | commands, branches, a session's tool calls |
| `stat` | the figure of a statistic |

Numbers use the mono family (tabular). French typography: a narrow no-break
space before « : ; ? ! » and inside « ».

## Layout

- Mobile first; the layout switches at **1280px** (`@media (min-width:
  1280px)`), the only breakpoint.
- **390**: the **Cadre** is a top bar (`header-height`: brand, Runner state)
  and a tab bar at the bottom (`tab-bar`): À toi, Idées, Conceptions, Boucle,
  Plus (Planning, Statistiques, Projets, Runner et Comptes IA, Paramètres).
  Margins `space-4`. Lists are compact rows; secondary panels move after the
  main content; one primary action in the page header. A session, a dialog
  and a review take the whole screen.
- **1280**: the **Cadre** is a sidebar (`sidebar-width`) with the same entries
  and the Runner's state at its foot; the page is `space-10` from it, at most
  `page-max` wide, with an optional aside (`aside-width`) on the right. A
  session opens as a right panel (`panel-width`) over the page.
- **Gestion du process** (1280 only) takes the whole height: the **Cadre**
  keeps its icons (`AppShell/Compact`, `sidebar-compact`), the page header,
  then the editor: the canvas (`side` with a `line` dot grid) and its panel
  (`aside-width`: Manques, Étape, Sources, with the versions at its foot). At
  390 the same page is the read-only list (US-98): the Manques first, then
  one `PhaseGroup` per **Phase** (the ones with a **Manque** open, the
  longest folded), then the **Sources**; a draft is read with its banner.
  The panel's sections that are long (an **Étape**'s Entrées et Sorties)
  fold (`<details class="editor-fold">`).
- Views are global: every list shows all the **Projets**, filtered by the
  Projet chips under the page title.
- Density: rows of 56 to 72 px, `space-3` to `space-4` paddings, 2 to 4 px
  radii; touch targets `touch` (44 px) at 390.

## Components

Each is a custom element `ui-<name>`; its root carries `data-name`.

**Shell and navigation**
- **AppShell** (`AppShell/Default`, `AppShell/Bare`, `AppShell/Compact`): `ui-app-shell
  current="a-toi|idees|conceptions|boucle|planning|statistiques|projets|runner|parametres"
  decisions runner="online|offline|resync"`; renders the **Cadre** (sidebar,
  phone header, tab bar); children are the page; `slot="banner"` above the
  page, `slot="panel"` a right panel (full screen at 390), `slot="overlay"`
  a dialog. `variant="bare"`: no navigation (sign in, getting started).
  `variant="compact"`: at 1280 the sidebar keeps its icons and the page
  fills the height (Gestion du process); at 390 the default **Cadre**.
- **PageHeader** (`PageHeader/Default`): `title`, `count`, `back` (link
  label), children are its actions; a landmark `header`.
- **ProjectFilter** (`ProjectFilter/Default`): the Projet chips; children
  `ui-chip`.
- **Chip** (`Chip/Default`, `Chip/Selected`): `count`, `selected`.
- **Tabs** (`Tabs/Default`): children `ui-tab` (`selected`, `count`).

**Actions**
- **Button** (`Button/Primary`, `Button/Secondary`, `Button/Ghost`,
  `Button/Danger`): `variant`, `size="sm"`, `icon`, `state="disabled|loading"`.
- **IconButton** (`IconButton/Default`): `icon`, `label` (its accessible
  name).

**Signals**
- **Icon** (`Icon/<name>`): `name`; inline SVG, `currentColor`.
- **StatusBadge** (`StatusBadge/<Tone>`): `tone="neutral|accent|go|caution|halt"`, text.
- **StatusDot** (`StatusDot/<Tone>`): `tone`, `pulse` (live).
- **Banner** (`Banner/<Tone>`): `tone="accent|go|caution|halt|neutral"`, `title`, `icon`; children text and
  actions. The resync and Runner offline messages.
- **Empty** (`Empty/Default`): `icon`, `title`; children text and action.

**Rows and cards**
- **Card** (`Card/Default`): `title` (a `section-label`), `count`, children;
  a `section` landmark when `label` is set.
- **DecisionRow** (`DecisionRow/<Tone>`): `kind`, `title`, `meta`, `tone`,
  `icon`; children context and actions (`slot="actions"`).
- **IdeaRow** (`IdeaRow/<State>`): `title`, `meta`, `state="en-analyse|a-trier|analysee|retenue|fusionnee|rejetee"`, `impact`, `effort`, `duplicates`; children the summary, `slot="actions"`.
- **TicketRow** (`TicketRow/<State>`): `number`, `title`, `meta`, `state`,
  `step`.
- **AgentRow** (`AgentRow/Default`): `projet`, `ticket`, `step`, `engine`,
  `since`, `tone`.
- **ListRow** (`ListRow/Default`): a generic row (`title`, `meta`, `icon`),
  children trailing.
- **ProcessTrack** (`ProcessTrack/Default`): children `ui-step`
  (`state="done|current|todo|off|halt|stopped"`, `stopped` an arrest decided
  elsewhere, at the **Source**, neither a failure nor a pause; `label`, `meta`); the stages of a
  **Conception**, of the getting started, of a **Ticket**.
- **UsageMeter** (`UsageMeter/Default`, `UsageMeter/Caution`,
  `UsageMeter/Halt`): `label`, `value` (0 to 100), `detail`.
- **Stat** (`Stat/Default`): `label`, `value`, `unit`, `detail`.
- **CheckRow** (`CheckRow/<State>`): `name`, `state="passed|failed|running"`, `detail`.
- **KeyValue** (`KeyValue/Default`): children `ui-kv` (`label`), a
  definition list.
- **CodeBlock** (`CodeBlock/Default`): a command, with « Copier ».
- **Capture** (`Capture/Default`): `src`, `label`, `width`; an image framed
  with its caption.
- **TicketTree** (`TicketTree/Default`): children `ui-tree-node`
  (`number`, `title`, `state`, `depth`, `blocked-by`).
- **Timeline** (`Timeline/Default`): the planning's weeks; children
  `ui-timeline-row` (`label`, `start`, `span`, `tone`, `meta`).

**Session (US-9)**
- **Session** (`Session/Default`): `title`, `meta`, `state="active|waiting|stopped|interrupted|failed"`, `resume-disabled` (« Reprendre » disabled, e.g. while the Runner is offline), `resume-label` and `resume-icon` (« Relancer » for a **Commande**, whose output reads as a session, US-104); children messages, then `ui-composer` (none for a **Commande**).
- **Message** (`Message/Agent`, `Message/Pilote`): `from`.
- **ToolCall** (`ToolCall/Default`): `tool`, `target`, `detail`.
- **Question** (`Question/Default`): `title`; children `ui-option`
  (`selected`, `detail`).
- **PermissionRequest** (`PermissionRequest/Default`): `tool`, children the
  command.
- **Composer** (`Composer/Default`, `Composer/Dictating`): `placeholder`,
  `state="dictating|disabled"`.

**Forms**
- **TextField** (`TextField/Default`, `TextField/Error`): `label`, `value`,
  `placeholder`, `help`, `state="error|disabled"`, `multiline`.
- **Select** (`Select/Default`): `label`, `value`, `help`.
- **Toggle** (`Toggle/On`, `Toggle/Off`): `label`, `checked`, `help`, `state="disabled"`.
- **Checkbox** (`Checkbox/Default`): `checked`, children label.
- **Radio** (`Radio/Default`): `checked`, `name`, children label.
- **SettingRow** (`SettingRow/Inherited`, `SettingRow/Changed`): `label`,
  `help`, `origin="compte|projet"`; children the control. Shows « Hérité du
  compte » or « Modifié pour ce Projet ».

**Process (Gestion du process, US-92 to US-98)**
- **ProcessCanvas** (`ProcessCanvas/Default`): `zoom` (percent), `pan="x,y"`
  (where the view is, in canvas units); children `ui-phase`, then
  `ui-process-arrow` (`from="<Étape>.<Sortie>"`, `to="<Étape>.<Entrée>"`,
  `state="active|gap|refused"`) and `ui-loop-back` (`from`, `to`, `max`,
  `state="active"`), drawn as one SVG layer once the cards are laid out:
  an arrow leaves its **Sortie** to the right, runs in the gutters between
  the cards (never under one), with rounded corners, and enters its
  **Entrée** from the left; arrows from different **Sorties** take
  separate lanes, those from one **Sortie** share their trunk;
  `slot="toast"` a message at its top, `slot="menu"` a menu opened from the
  panel, on its right edge; the zoom controls at its foot.
- **Phase** (`Phase/Default`, `Phase/Repeated`): `name`, `for-each`
  (« chaque Ticket prêt »: the `accent` top rail), `gaps`, `target` (where
  an added **Étape** goes), `col`/`row` on the canvas; children
  `ui-step-card`.
- **StepCard** (`StepCard/Agent`, `StepCard/Gate`, `StepCard/Command`, `StepCard/Core`):
  `ref`, `name`, `kind`, `variant`, `col`/`row` in its **Phase**,
  `selected` (`accent` border), `gaps` (`caution` border and count),
  `judges` (the Retour handle); children `ui-port` then `ui-tool-chip`. A
  gate of the **Pilote** is the compact card (`gate-card`, dashed, no
  **Outils**); `core` (a `line-strong` left rail) is what the product keeps
  before every merge: the Checks and the Merge.
- **Port** (`Port/In`, `Port/Out`): `dir`, `name`, the **Type d'artefact**
  as text, always, then `note` muted (what qualifies it: « retenue »,
  « des checks », « notée par toi »), `state="active|unfed|compatible|refused"`.
  An **Entrée** is a hollow dot on the left edge, a **Sortie** a filled one
  on the right, both in their type's colour (`type="<slug>"`, else read
  from the text: `idee`, `prd`, `maquettes`, `conception`, `inventaire`,
  `ticket`, `changement`, `verdict`, `livraison`).
- **ToolChip** (`ToolChip/<Kind>`): `kind="role|skill|mcp|commande|connecteur"`, the **Outil**'s name.
- **LoopBack** (`LoopBack/Default`): the **Retour**'s badge « Retour · 3 fois
  au plus » on its dashed `caution` curve.
- **PhaseGroup** (`PhaseGroup/Default`): the phone's **Phase**, a
  `<details>`: `name`, `for-each`, `count`, `gaps`, `open`; children
  `ui-step-row`.
- **StepRow** (`StepRow/Default`, `StepRow/Gap`): `name`, `kind`, `icon`,
  `tools`, `flow` (« Entrées → Sorties »), `loop-back`, `gap`.
- **Stepper** (`Stepper/Default`): `label`, `value`, `unit`, `min`, `max`
  (a **Retour**'s maximum, 1 to 10).
- **Menu** (`Menu/Default`): `title`; children `ui-menu-group` (`label`)
  of `ui-menu-item` (`icon`, `detail`, `selected`, `state="disabled"`): the
  catalogue of **Étapes**, « Attacher un Outil ».
- **Toast** (`Toast/<Tone>`): `tone="accent|go|halt"`, `icon`: the reason
  an arrow is refused.

**Overlays**
- **Dialog** (`Dialog/Default`): `title`; children body, `slot="actions"`.
- **ConfirmDialog** (`ConfirmDialog/Default`): the product's own confirmation
  of an **Action sensible** (US-26): `title`, `action` (the button's label),
  a « Confirmé par Crewdeck » mark no **Skin** can replace; children the
  consequences.

## Interactive states

- Hover: rows and plain buttons take `raised`; the primary button
  `accent-hover`; links `accent-hover`.
- Focus-visible: a 2 px `accent` outline, 2 px offset, on every control.
- Pressed: `accent-pressed`, plain buttons `sunk`.
- Stop (the Boucle, a session, a dictation): a secondary button with the
  `stop` icon; `danger` only for what destroys (delete a Planification).
- Disabled: 45 % opacity, no pointer; an **Action sensible** during the
  **Resynchronisation** is disabled with the reason beside it.
- Loading: the button keeps its width, its icon becomes a spinner.
- Error: the field's border and help in `halt`, the message under it.

## Copy

- French, tutoiement, short; the glossary's terms with their capital
  (**Projet**, **Idée**, **Ticket**, **Boucle**, **Décision**, **Runner**,
  **Compte IA**, **Moteur**, **Rôle**, **Conception**, **Étape**,
  **Contrat**, **Skin**, **Composant**, **Paramètres**, **Planification**);
  « À toi » with its quotes in running text.
- A **Décision**'s title: its kind, then its object (« Ticket bloqué · #42
  Connexion GitHub »); its context says what to do.
- Times relative under a day (« il y a 4 min »), then « hier », then
  « 12 nov. »; hours `16:40`; numbers with a narrow no-break space for
  thousands, `,` decimal, ` %` and ` €` after a no-break space.

## Do / Don't

- Do put one primary action per group, in the page header at 390.
- Do show an **Action sensible** through `ui-confirm-dialog` only.
- Don't colour a whole card for a state: a rail, a dot, a badge.
- Don't use another breakpoint than 1280px, nor a value outside
  `tokens.css`.
