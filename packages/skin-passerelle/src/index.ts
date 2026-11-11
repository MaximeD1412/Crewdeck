/**
 * The default Skin, « Passerelle » (`design/DESIGN.md`): its `cd-*` Composants
 * are Lit 3 custom elements (ADR 0006), defined by the core at boot. It imports
 * only `@crewdeck/sdk`, `lit`, `@fontsource/*` and its own files; the page
 * loads `tokens.css` and `fonts.css` beside it.
 */
import { defineSkin } from '@crewdeck/sdk';
import { PasserelleBanner } from './banner.js';
import { PasserelleButton } from './button.js';
import { PasserelleCadre } from './cadre.js';
import { PasserelleCard } from './card.js';
import { PasserelleChip } from './chip.js';
import { PasserelleCodeBlock } from './code-block.js';
import { PasserelleComposer } from './composer.js';
import { PasserelleEmpty } from './empty.js';
import { PasserelleIconButton } from './icon-button.js';
import { PasserelleIcon } from './icon.js';
import { PasserelleKeyValue } from './key-value.js';
import { PasserelleListRow } from './list-row.js';
import { PasserelleMenuItem } from './menu-item.js';
import { PasserelleMessage } from './message.js';
import { PasserellePageComposants } from './page-composants.js';
import { PasserellePageHeader } from './page-header.js';
import { PasserellePageIntrouvable } from './page-introuvable.js';
import { PasserellePermissionRequest } from './permission-request.js';
import { PasserelleProjectFilter } from './project-filter.js';
import { PasserelleQuestion } from './question.js';
import { PasserelleSession } from './session.js';
import { PasserelleStatusBadge } from './status-badge.js';
import { PasserelleStatusDot } from './status-dot.js';
import { PasserelleTabs } from './tabs.js';
import { PasserelleToolCall } from './tool-call.js';

export default defineSkin({
  id: 'passerelle',
  parent: null,
  targets: ['pc', 'telephone'],
  composants: {
    Cadre: PasserelleCadre,
    MenuItem: PasserelleMenuItem,
    PageHeader: PasserellePageHeader,
    ProjectFilter: PasserelleProjectFilter,
    PageComposants: PasserellePageComposants,
    PageIntrouvable: PasserellePageIntrouvable,
    Card: PasserelleCard,
    CodeBlock: PasserelleCodeBlock,
    KeyValue: PasserelleKeyValue,
    ListRow: PasserelleListRow,
    Session: PasserelleSession,
    Message: PasserelleMessage,
    ToolCall: PasserelleToolCall,
    Question: PasserelleQuestion,
    PermissionRequest: PasserellePermissionRequest,
    Composer: PasserelleComposer,
    Banner: PasserelleBanner,
    Button: PasserelleButton,
    Chip: PasserelleChip,
    Empty: PasserelleEmpty,
    Icon: PasserelleIcon,
    IconButton: PasserelleIconButton,
    StatusBadge: PasserelleStatusBadge,
    StatusDot: PasserelleStatusDot,
    Tabs: PasserelleTabs,
  },
});
