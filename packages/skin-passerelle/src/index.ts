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
import { PasserelleCadre } from './cadre.js';
import { PasserelleCapture } from './capture.js';
import { PasserelleCard } from './card.js';
import { PasserelleCheckRow } from './check-row.js';
import { PasserelleCheckbox } from './checkbox.js';
import { PasserelleChip } from './chip.js';
import { PasserelleCodeBlock } from './code-block.js';
import { PasserelleComposer } from './composer.js';
import { PasserelleDecisionRow } from './decision-row.js';
import { PasserelleDialog } from './dialog.js';
import { PasserelleEmpty } from './empty.js';
import { PasserelleIdeaRow } from './idea-row.js';
import { PasserelleIconButton } from './icon-button.js';
import { PasserelleIcon } from './icon.js';
import { PasserelleKeyValue } from './key-value.js';
import { PasserelleListRow } from './list-row.js';
import { PasserelleMenu } from './menu.js';
import { PasserelleMenuItem } from './menu-item.js';
import { PasserelleMessage } from './message.js';
import { PasserellePageAToi } from './page-a-toi.js';
import { PasserellePageComposants } from './page-composants.js';
import { PasserellePageConnexion } from './page-connexion.js';
import { PasserellePageDemarrage } from './page-demarrage.js';
import { PasserellePageHeader } from './page-header.js';
import { PasserellePageIntrouvable } from './page-introuvable.js';
import { PasserellePageRunner } from './page-runner.js';
import { PasserellePermissionRequest } from './permission-request.js';
import { PasserellePhaseGroup } from './phase-group.js';
import { PasserelleProcessTrack } from './process-track.js';
import { PasserelleProjectFilter } from './project-filter.js';
import { PasserelleQuestion } from './question.js';
import { PasserelleSession } from './session.js';
import { PasserelleRadio } from './radio.js';
import { PasserelleSelect } from './select.js';
import { PasserelleSettingRow } from './setting-row.js';
import { PasserelleStat } from './stat.js';
import { PasserelleStatusBadge } from './status-badge.js';
import { PasserelleStatusDot } from './status-dot.js';
import { PasserelleStepRow } from './step-row.js';
import { PasserelleStepper } from './stepper.js';
import { PasserelleTabs } from './tabs.js';
import { PasserelleTextField } from './text-field.js';
import { PasserelleTicketRow } from './ticket-row.js';
import { PasserelleTicketTree } from './ticket-tree.js';
import { PasserelleTimeline } from './timeline.js';
import { PasserelleToolCall } from './tool-call.js';
import { PasserelleToggle } from './toggle.js';
import { PasserelleUsageMeter } from './usage-meter.js';

export default defineSkin({
  id: 'passerelle',
  parent: null,
  targets: ['pc', 'telephone'],
  composants: {
    Cadre: PasserelleCadre,
    MenuItem: PasserelleMenuItem,
    PageHeader: PasserellePageHeader,
    ProjectFilter: PasserelleProjectFilter,
    PageAToi: PasserellePageAToi,
    PageComposants: PasserellePageComposants,
    PageConnexion: PasserellePageConnexion,
    PageDemarrage: PasserellePageDemarrage,
    PageIntrouvable: PasserellePageIntrouvable,
    PageRunner: PasserellePageRunner,
    Card: PasserelleCard,
    CodeBlock: PasserelleCodeBlock,
    Dialog: PasserelleDialog,
    KeyValue: PasserelleKeyValue,
    ListRow: PasserelleListRow,
    Session: PasserelleSession,
    Message: PasserelleMessage,
    ToolCall: PasserelleToolCall,
    Question: PasserelleQuestion,
    PermissionRequest: PasserellePermissionRequest,
    Composer: PasserelleComposer,
    SettingRow: PasserelleSettingRow,
    DecisionRow: PasserelleDecisionRow,
    IdeaRow: PasserelleIdeaRow,
    TicketRow: PasserelleTicketRow,
    AgentRow: PasserelleAgentRow,
    ProcessTrack: PasserelleProcessTrack,
    UsageMeter: PasserelleUsageMeter,
    Stat: PasserelleStat,
    CheckRow: PasserelleCheckRow,
    Capture: PasserelleCapture,
    TicketTree: PasserelleTicketTree,
    Timeline: PasserelleTimeline,
    PhaseGroup: PasserellePhaseGroup,
    StepRow: PasserelleStepRow,
    Menu: PasserelleMenu,
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
    Stepper: PasserelleStepper,
    Tabs: PasserelleTabs,
    TextField: PasserelleTextField,
    Toggle: PasserelleToggle,
  },
});
