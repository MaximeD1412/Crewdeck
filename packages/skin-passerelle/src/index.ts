/**
 * The default Skin, « Passerelle » (`design/DESIGN.md`): its `cd-*` Composants
 * are Lit 3 custom elements (ADR 0006), defined by the core at boot. It imports
 * only `@crewdeck/sdk`, `lit`, `@fontsource/*` and its own files; the page
 * loads `tokens.css` and `fonts.css` beside it.
 */
import { defineSkin } from '@crewdeck/sdk';
import { PasserelleAgentRow } from './agent-row.js';
import { PasserelleBanner } from './banner.js';
import { PasserelleButton } from './button.js';
import { PasserelleCard } from './card.js';
import { PasserelleChip } from './chip.js';
import { PasserelleCodeBlock } from './code-block.js';
import { PasserelleDecisionRow } from './decision-row.js';
import { PasserelleEmpty } from './empty.js';
import { PasserelleIdeaRow } from './idea-row.js';
import { PasserelleIconButton } from './icon-button.js';
import { PasserelleIcon } from './icon.js';
import { PasserelleKeyValue } from './key-value.js';
import { PasserelleListRow } from './list-row.js';
import { PasserellePageComposants } from './page-composants.js';
import { PasserellePageHeader } from './page-header.js';
import { PasserellePageIntrouvable } from './page-introuvable.js';
import { PasserelleProjectFilter } from './project-filter.js';
import { PasserelleStatusBadge } from './status-badge.js';
import { PasserelleStatusDot } from './status-dot.js';
import { PasserelleTabs } from './tabs.js';
import { PasserelleTicketRow } from './ticket-row.js';

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
    KeyValue: PasserelleKeyValue,
    ListRow: PasserelleListRow,
    DecisionRow: PasserelleDecisionRow,
    IdeaRow: PasserelleIdeaRow,
    TicketRow: PasserelleTicketRow,
    AgentRow: PasserelleAgentRow,
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
