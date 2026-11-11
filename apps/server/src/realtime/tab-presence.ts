import { Injectable } from '@nestjs/common';

/** What a tab last said of its visibility: `null` before its first `visibility`, `since` when it said it (or opened). */
export interface TabVisibility {
  readonly visible: boolean | null;
  readonly since: Date;
}

/**
 * The open tabs of each Pilote (their sockets of `/api/ws`) and their last
 * `visibility`: the push of ATOI-4 reads it, a Décision pushed when no tab
 * has been visible for 2 minutes (ADR 0007). In memory: one server process.
 */
@Injectable()
export class TabPresence {
  private readonly tabs = new Map<string, Map<object, TabVisibility>>();

  open(pilotId: string, tab: object, now = new Date()): void {
    const tabs = this.tabs.get(pilotId) ?? new Map<object, TabVisibility>();
    tabs.set(tab, { visible: null, since: now });
    this.tabs.set(pilotId, tabs);
  }

  setVisibility(pilotId: string, tab: object, visible: boolean, now = new Date()): void {
    const tabs = this.tabs.get(pilotId);
    if (tabs?.has(tab)) tabs.set(tab, { visible, since: now });
  }

  close(pilotId: string, tab: object): void {
    const tabs = this.tabs.get(pilotId);
    tabs?.delete(tab);
    if (tabs?.size === 0) this.tabs.delete(pilotId);
  }

  /** The open tabs of `pilotId`, none when they have no Crewdeck tab open. */
  tabsOf(pilotId: string): readonly TabVisibility[] {
    return [...(this.tabs.get(pilotId)?.values() ?? [])];
  }
}
