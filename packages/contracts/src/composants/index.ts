import { Banner } from './banner.js';
import { Button } from './button.js';
import { Cadre, MenuItem } from './cadre.js';
import { Capture } from './capture.js';
import { Card } from './card.js';
import { CheckRow } from './check-row.js';
import { Chip } from './chip.js';
import { CodeBlock } from './code-block.js';
import type { AnyComposant } from './define.js';
import { Empty } from './empty.js';
import { IconButton } from './icon-button.js';
import { Icon } from './icon.js';
import { KeyValue } from './key-value.js';
import { ListRow } from './list-row.js';
import { PageComposants } from './page-composants.js';
import { PageHeader } from './page-header.js';
import { PageIntrouvable } from './page-introuvable.js';
import { ProcessTrack } from './process-track.js';
import { ProjectFilter } from './project-filter.js';
import { Stat } from './stat.js';
import { StatusBadge } from './status-badge.js';
import { StatusDot } from './status-dot.js';
import { Tabs } from './tabs.js';
import { TicketTree } from './ticket-tree.js';
import { Timeline } from './timeline.js';
import { UsageMeter } from './usage-meter.js';

export * from './action.js';
export * from './banner.js';
export * from './button.js';
export * from './cadre.js';
export * from './capture.js';
export * from './card.js';
export * from './check-row.js';
export * from './chip.js';
export * from './code-block.js';
export * from './define.js';
export * from './empty.js';
export * from './icon-button.js';
export * from './icon.js';
export * from './icons.js';
export * from './key-value.js';
export * from './list-row.js';
export * from './page-composants.js';
export * from './page-header.js';
export * from './page-introuvable.js';
export * from './process-track.js';
export * from './project-filter.js';
export * from './stat.js';
export * from './status-badge.js';
export * from './status-dot.js';
export * from './tabs.js';
export * from './ticket-row-state.js';
export * from './ticket-tree.js';
export * from './timeline.js';
export * from './tone.js';
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
  PageIntrouvable,
  Card,
  CodeBlock,
  KeyValue,
  ListRow,
  ProcessTrack,
  UsageMeter,
  Stat,
  CheckRow,
  Capture,
  TicketTree,
  Timeline,
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
