import { Injectable } from '@nestjs/common';

/** What a tab last said of its visibility: `null` before its first `visibility`, `since` when it said it (or opened). */
export interface TabVisibility {
  readonly visible: boolean | null;
  readonly since: Date;
}

/** Told of every change of a Pilote's tabs: one opened, said its visibility, or closed. */
export type TabsListener = (pilotId: string) => void;

/**
 * The open tabs of each Pilote (their sockets of `/api/ws`) and their last
 * `visibility`, dropped with the socket; and when a tab of theirs was last
 * visible, kept after it: the push of ATOI-4 reads it, a Décision pushed when
 * no tab has been visible for 2 minutes (ADR 0007). A tab that has not said
 * its visibility yet is not visible. In memory: one server process.
 */
@Injectable()
export class TabPresence {
  private readonly tabs = new Map<string, Map<object, TabVisibility>>();
  private readonly lastVisible = new Map<string, Date>();
  private readonly listeners = new Set<TabsListener>();

  open(pilotId: string, tab: object, now = new Date()): void {
    const tabs = this.tabs.get(pilotId) ?? new Map<object, TabVisibility>();
    tabs.set(tab, { visible: null, since: now });
    this.tabs.set(pilotId, tabs);
    this.changed(pilotId);
  }

  setVisibility(pilotId: string, tab: object, visible: boolean, now = new Date()): void {
    const tabs = this.tabs.get(pilotId);
    const previous = tabs?.get(tab);
    if (!tabs || !previous) return;
    if (previous.visible === true && !visible) this.lastVisible.set(pilotId, now);
    tabs.set(tab, { visible, since: now });
    this.changed(pilotId);
  }

  close(pilotId: string, tab: object, now = new Date()): void {
    const tabs = this.tabs.get(pilotId);
    if (!tabs?.has(tab)) return;
    if (tabs.get(tab)?.visible === true) this.lastVisible.set(pilotId, now);
    tabs.delete(tab);
    if (tabs.size === 0) this.tabs.delete(pilotId);
    this.changed(pilotId);
  }

  /** Whether a tab of `pilotId` is visible now. */
  anyVisible(pilotId: string): boolean {
    return this.tabsOf(pilotId).some((tab) => tab.visible === true);
  }

  /** When a tab of `pilotId` was last visible: `now` while one is, `null` when none ever was since the server started. */
  lastVisibleAt(pilotId: string, now = new Date()): Date | null {
    return this.anyVisible(pilotId) ? now : (this.lastVisible.get(pilotId) ?? null);
  }

  /** Calls `listener` after every change of a Pilote's tabs; returns its removal. */
  onChange(listener: TabsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(pilotId: string): void {
    for (const listener of this.listeners) listener(pilotId);
  }

  /** The open tabs of `pilotId`, none when they have no Crewdeck tab open. */
  tabsOf(pilotId: string): readonly TabVisibility[] {
    return [...(this.tabs.get(pilotId)?.values() ?? [])];
  }
}
