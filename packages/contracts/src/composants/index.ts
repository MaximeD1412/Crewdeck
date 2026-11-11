import { AgentRow } from './agent-row.js';
import { Banner } from './banner.js';
import { Button } from './button.js';
import { Cadre, MenuItem } from './cadre.js';
import { Card } from './card.js';
import { Chip } from './chip.js';
import { CodeBlock } from './code-block.js';
import { Composer } from './composer.js';
import { DecisionRow } from './decision-row.js';
import type { AnyComposant } from './define.js';
import { Empty } from './empty.js';
import { IdeaRow } from './idea-row.js';
import { IconButton } from './icon-button.js';
import { Icon } from './icon.js';
import { KeyValue } from './key-value.js';
import { ListRow } from './list-row.js';
import { Message } from './message.js';
import { PageComposants } from './page-composants.js';
import { PageHeader } from './page-header.js';
import { PageIntrouvable } from './page-introuvable.js';
import { PermissionRequest } from './permission-request.js';
import { ProjectFilter } from './project-filter.js';
import { Question } from './question.js';
import { Session } from './session.js';
import { StatusBadge } from './status-badge.js';
import { StatusDot } from './status-dot.js';
import { Tabs } from './tabs.js';
import { TicketRow } from './ticket-row.js';
import { ToolCall } from './tool-call.js';

export * from './action.js';
export * from './agent-row.js';
export * from './banner.js';
export * from './button.js';
export * from './cadre.js';
export * from './card.js';
export * from './chip.js';
export * from './code-block.js';
export * from './composer.js';
export * from './decision-row.js';
export * from './define.js';
export * from './empty.js';
export * from './icon-button.js';
export * from './idea-row.js';
export * from './icon.js';
export * from './icons.js';
export * from './key-value.js';
export * from './list-row.js';
export * from './message.js';
export * from './page-composants.js';
export * from './page-header.js';
export * from './page-introuvable.js';
export * from './permission-request.js';
export * from './project-filter.js';
export * from './question.js';
export * from './session.js';
export * from './status-badge.js';
export * from './status-dot.js';
export * from './tabs.js';
export * from './ticket-row.js';
export * from './tone.js';
export * from './tool-call.js';

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
  PageIntrouvable,
  Card,
  CodeBlock,
  KeyValue,
  ListRow,
  Session,
  Message,
  ToolCall,
  Question,
  PermissionRequest,
  Composer,
  DecisionRow,
  IdeaRow,
  TicketRow,
  AgentRow,
  Banner,
  Button,
  Chip,
  Empty,
  Icon,
  IconButton,
  StatusBadge,
  StatusDot,
  Tabs,
} as const satisfies Record<string, AnyComposant>;

export type ComposantName = keyof typeof COMPOSANTS;
