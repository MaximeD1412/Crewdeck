/**
 * The default Skin, « Passerelle » (`design/DESIGN.md`): its `cd-*` Composants
 * are Lit 3 custom elements (ADR 0006), defined by the core at boot. It imports
 * only `@crewdeck/sdk`, `lit`, `@fontsource/*` and its own files; the page
 * loads `tokens.css` and `fonts.css` beside it.
 */
import { defineSkin } from '@crewdeck/sdk';
import { PasserelleBanner } from './banner.js';
import { PasserelleButton } from './button.js';
import { PasserelleCard } from './card.js';
import { PasserelleCheckbox } from './checkbox.js';
import { PasserelleChip } from './chip.js';
import { PasserelleCodeBlock } from './code-block.js';
import { PasserelleDialog } from './dialog.js';
import { PasserelleEmpty } from './empty.js';
import { PasserelleIconButton } from './icon-button.js';
import { PasserelleIcon } from './icon.js';
import { PasserelleKeyValue } from './key-value.js';
import { PasserelleListRow } from './list-row.js';
import { PasserellePageComposants } from './page-composants.js';
import { PasserellePageHeader } from './page-header.js';
import { PasserellePageIntrouvable } from './page-introuvable.js';
import { PasserelleProjectFilter } from './project-filter.js';
import { PasserelleRadio } from './radio.js';
import { PasserelleSelect } from './select.js';
import { PasserelleSettingRow } from './setting-row.js';
import { PasserelleStatusBadge } from './status-badge.js';
import { PasserelleStatusDot } from './status-dot.js';
import { PasserelleTabs } from './tabs.js';
import { PasserelleTextField } from './text-field.js';
import { PasserelleToggle } from './toggle.js';

export default defineSkin({
  id: 'passerelle',
  parent: null,
  targets: ['pc', 'telephone'],
  composants: {
    PageHeader: PasserellePageHeader,
    ProjectFilter: PasserelleProjectFilter,
    PageComposants: PasserellePageComposants,
    PageIntrouvable: PasserellePageIntrouvable,
    Card: PasserelleCard,
    CodeBlock: PasserelleCodeBlock,
    Dialog: PasserelleDialog,
    KeyValue: PasserelleKeyValue,
    ListRow: PasserelleListRow,
    SettingRow: PasserelleSettingRow,
    Banner: PasserelleBanner,
    Button: PasserelleButton,
    Checkbox: PasserelleCheckbox,
    Chip: PasserelleChip,
    Empty: PasserelleEmpty,
    Icon: PasserelleIcon,
    IconButton: PasserelleIconButton,
    Radio: PasserelleRadio,
    Select: PasserelleSelect,
    StatusBadge: PasserelleStatusBadge,
    StatusDot: PasserelleStatusDot,
    Tabs: PasserelleTabs,
    TextField: PasserelleTextField,
    Toggle: PasserelleToggle,
  },
});
