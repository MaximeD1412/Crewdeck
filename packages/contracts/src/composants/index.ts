import { AgentRow } from './agent-row.js';
import { Banner } from './banner.js';
import { Button } from './button.js';
import { Cadre, MenuItem } from './cadre.js';
import { Capture } from './capture.js';
import { Card } from './card.js';
import { CheckRow } from './check-row.js';
import { Checkbox } from './checkbox.js';
import { Chip } from './chip.js';
import { CodeBlock } from './code-block.js';
import { Composer } from './composer.js';
import { DecisionRow } from './decision-row.js';
import type { AnyComposant } from './define.js';
import { Dialog } from './dialog.js';
import { Empty } from './empty.js';
import { IdeaRow } from './idea-row.js';
import { IconButton } from './icon-button.js';
import { Icon } from './icon.js';
import { KeyValue } from './key-value.js';
import { ListRow } from './list-row.js';
import { Message } from './message.js';
import { PageComposants } from './page-composants.js';
import { PageConnexion } from './page-connexion.js';
import { PageDemarrage } from './page-demarrage.js';
import { PageHeader } from './page-header.js';
import { PageIntrouvable } from './page-introuvable.js';
import { PageRunner } from './page-runner.js';
import { PermissionRequest } from './permission-request.js';
import { ProcessTrack } from './process-track.js';
import { ProjectFilter } from './project-filter.js';
import { Question } from './question.js';
import { Session } from './session.js';
import { Radio } from './radio.js';
import { Select } from './select.js';
import { SettingRow } from './setting-row.js';
import { Stat } from './stat.js';
import { StatusBadge } from './status-badge.js';
import { StatusDot } from './status-dot.js';
import { Tabs } from './tabs.js';
import { TextField } from './text-field.js';
import { TicketRow } from './ticket-row.js';
import { TicketTree } from './ticket-tree.js';
import { Timeline } from './timeline.js';
import { ToolCall } from './tool-call.js';
import { Toggle } from './toggle.js';
import { UsageMeter } from './usage-meter.js';

export * from './action.js';
export * from './agent-row.js';
export * from './banner.js';
export * from './button.js';
export * from './cadre.js';
export * from './capture.js';
export * from './card.js';
export * from './check-row.js';
export * from './checkbox.js';
export * from './chip.js';
export * from './code-block.js';
export * from './composer.js';
export * from './decision-row.js';
export * from './define.js';
export * from './dialog.js';
export * from './empty.js';
export * from './engine-account.js';
export * from './icon-button.js';
export * from './idea-row.js';
export * from './icon.js';
export * from './icons.js';
export * from './key-value.js';
export * from './list-row.js';
export * from './message.js';
export * from './page-composants.js';
export * from './page-connexion.js';
export * from './page-demarrage.js';
export * from './page-header.js';
export * from './page-introuvable.js';
export * from './page-runner.js';
export * from './permission-request.js';
export * from './process-track.js';
export * from './project-filter.js';
export * from './question.js';
export * from './session.js';
export * from './radio.js';
export * from './select.js';
export * from './sensitive.js';
export * from './setting-row.js';
export * from './stat.js';
export * from './status-badge.js';
export * from './status-dot.js';
export * from './tabs.js';
export * from './text-field.js';
export * from './ticket-row.js';
export * from './ticket-tree.js';
export * from './timeline.js';
export * from './toggle.js';
export * from './tone.js';
export * from './tool-call.js';
export * from './usage-meter.js';

/**
 * Every Composant's declaration, by name: a Skin (with its parents) implements
 * each of them, and the library's page (`/parametres/composants`) lists them.
 * The UI and page tickets add theirs.
 */
export const COMPOSANTS = {
  Cadre,
  MenuItem,
  PageHeader,
  ProjectFilter,
  PageComposants,
  PageConnexion,
  PageDemarrage,
  PageIntrouvable,
  PageRunner,
  Card,
  CodeBlock,
  Dialog,
  KeyValue,
  ListRow,
  Session,
  Message,
  ToolCall,
  Question,
  PermissionRequest,
  Composer,
  SettingRow,
  DecisionRow,
  IdeaRow,
  TicketRow,
  AgentRow,
  ProcessTrack,
  UsageMeter,
  Stat,
  CheckRow,
  Capture,
  TicketTree,
  Timeline,
  Banner,
  Button,
  Checkbox,
  Chip,
  Empty,
  Icon,
  IconButton,
  Radio,
  Select,
  StatusBadge,
  StatusDot,
  Tabs,
  TextField,
  Toggle,
} as const satisfies Record<string, AnyComposant>;

export type ComposantName = keyof typeof COMPOSANTS;
