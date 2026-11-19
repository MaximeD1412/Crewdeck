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
import { PasserelleFolderProjectForm } from './folder-project-form.js';
import { PasserelleIdeaRow } from './idea-row.js';
import { PasserelleNoteIdeaDialog } from './note-idea-dialog.js';
import { PasserelleIconButton } from './icon-button.js';
import { PasserelleIcon } from './icon.js';
import { PasserelleKeyValue } from './key-value.js';
import { PasserelleListRow } from './list-row.js';
import { PasserelleLoopBack } from './loop-back.js';
import { PasserelleMenu } from './menu.js';
import { PasserelleMenuItem } from './menu-item.js';
import { PasserelleMessage } from './message.js';
import { PasserellePageAToi } from './page-a-toi.js';
import { PasserellePageAjouterProjet } from './page-ajouter-projet.js';
import { PasserellePageIdees } from './page-idees.js';
import { PasserellePageComposants } from './page-composants.js';
import { PasserellePageConnexion } from './page-connexion.js';
import { PasserellePageConnexionLien } from './page-connexion-lien.js';
import { PasserellePageDemarrage } from './page-demarrage.js';
import { PasserellePageParametres } from './page-parametres.js';
import { PasserellePageHeader } from './page-header.js';
import { PasserellePageIntrouvable } from './page-introuvable.js';
import { PasserellePageProjet } from './page-projet.js';
import { PasserellePageProjets } from './page-projets.js';
import { PasserellePageRunner } from './page-runner.js';
import { PasserellePermissionRequest } from './permission-request.js';
import { PasserellePhase } from './phase.js';
import { PasserellePort } from './port.js';
import { PasserelleProcessCanvas } from './process-canvas.js';
import { PasserellePhaseGroup } from './phase-group.js';
import { PasserelleProcessTrack } from './process-track.js';
import { PasserelleProjectFilter } from './project-filter.js';
import { PasserelleQuestion } from './question.js';
import { PasserelleSession } from './session.js';
import { PasserelleRadio } from './radio.js';
import { PasserelleRepositoryPicker } from './repository-picker.js';
import { PasserelleRoleSettings } from './role-settings.js';
import { PasserelleSelect } from './select.js';
import { PasserelleSettingRow } from './setting-row.js';
import { PasserelleStat } from './stat.js';
import { PasserelleStatusBadge } from './status-badge.js';
import { PasserelleStatusDot } from './status-dot.js';
import { PasserelleStepCard } from './step-card.js';
import { PasserelleStepRow } from './step-row.js';
import { PasserelleStepper } from './stepper.js';
import { PasserelleTabs } from './tabs.js';
import { PasserelleTextField } from './text-field.js';
import { PasserelleTicketRow } from './ticket-row.js';
import { PasserelleTicketTree } from './ticket-tree.js';
import { PasserelleTimeline } from './timeline.js';
import { PasserelleToast } from './toast.js';
import { PasserelleToolCall } from './tool-call.js';
import { PasserelleToggle } from './toggle.js';
import { PasserelleToolChip } from './tool-chip.js';
import { PasserelleUsageCard } from './usage-card.js';
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
    PageAjouterProjet: PasserellePageAjouterProjet,
    PageIdees: PasserellePageIdees,
    PageComposants: PasserellePageComposants,
    PageConnexion: PasserellePageConnexion,
    PageConnexionLien: PasserellePageConnexionLien,
    PageDemarrage: PasserellePageDemarrage,
    PageParametres: PasserellePageParametres,
    PageIntrouvable: PasserellePageIntrouvable,
    PageProjet: PasserellePageProjet,
    PageProjets: PasserellePageProjets,
    PageRunner: PasserellePageRunner,
    RepositoryPicker: PasserelleRepositoryPicker,
    FolderProjectForm: PasserelleFolderProjectForm,
    RoleSettings: PasserelleRoleSettings,
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
    NoteIdeaDialog: PasserelleNoteIdeaDialog,
    TicketRow: PasserelleTicketRow,
    AgentRow: PasserelleAgentRow,
    ProcessTrack: PasserelleProcessTrack,
    ProcessCanvas: PasserelleProcessCanvas,
    Phase: PasserellePhase,
    StepCard: PasserelleStepCard,
    Port: PasserellePort,
    ToolChip: PasserelleToolChip,
    LoopBack: PasserelleLoopBack,
    UsageMeter: PasserelleUsageMeter,
    UsageCard: PasserelleUsageCard,
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
    Toast: PasserelleToast,
    Toggle: PasserelleToggle,
  },
});
