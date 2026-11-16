import {
  type ProjectSettings,
  type ProjectSettingsPatch,
  type ProjectSettingsUpdated,
  type RoleChoice,
  type SealedItem,
  withSeq,
  zId,
  zProjectSettings,
  zProjectSettingsPatch,
  zProjectSettingsUpdated,
  zSealedItem,
} from '@crewdeck/contracts';
import { Body, Controller, Get, Injectable, Param, Patch } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PROJECT_VIEW, toProject } from '../projects/project.view.js';
import { ProjectChanges } from '../projects/project-changes.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { type Tx, Transactions } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { overridesOf, SettingsService, validateRoleChoices } from './settings.service.js';

export class ProjectSettingsDto extends createZodDto(zProjectSettings) {}
export class ProjectSettingsUpdatedDto extends createZodDto(zProjectSettingsUpdated) {}
/** No 409 on it: a setting is a value, the last write wins. */
export class ProjectSettingsPatchDto extends createZodDto(withSeq(zProjectSettingsPatch)) {}

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);

/** The Rôles' choices `patch` gives, by Rôle id: `null` back to the account. */
const roleChoices = (patch: ProjectSettingsPatch): [string, RoleChoice][] =>
  Object.entries(patch.roles ?? {}).filter((entry): entry is [string, RoleChoice] => entry[1] !== undefined);

/**
 * The Paramètres of a Projet (PARAM-3, US-82): what it changes over the
 * account (its Rôles, push on or off) in `project_settings`, its branches on
 * `projects`, its two worktree Commandes as one sealed item the server never
 * opens (ADR 0003, ADR 0011).
 */
@Injectable()
export class ProjectSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsWriter,
    private readonly settings: SettingsService,
  ) {}

  /** `GET /api/projects/:id/settings`; 404 `project.not-found` for a Projet that is not the Pilote's. In the Pilote's scope. */
  async get(pilotId: string, projectId: string): Promise<ProjectSettings> {
    const settings = zId.safeParse(projectId).success ? await this.settings.project(pilotId, projectId) : null;
    if (!settings) throw projectNotFound();
    return settings;
  }

  /** The sealed worktree Commandes of the Pilote's Projet `projectId` (RUNNER-20 hands them to the Runner), `null` for none. In the Pilote's scope. */
  async worktreeCommands(projectId: string): Promise<SealedItem | null> {
    const row = await this.prisma.scoped.projectSettings.findFirst({ where: { projectId }, select: { worktreeCommands: true } });
    return row?.worktreeCommands ? zSealedItem.parse(row.worktreeCommands) : null;
  }

  /**
   * Writes what `patch` changes; returns the Projet's Paramètres, written in
   * `settings.upserted` `{ projectSettings }` in the same `tx` (`seq`, that
   * event's), with
   * `project.upserted` when a branch changes (`branchesChanged` then true).
   * 404 for a Projet that is not the Pilote's; a Rôle validated as the
   * account's (400 on an unknown id, 422 `settings.engine-unusable`), `null`
   * back to the account; 422 `settings.branches-same` when both branches
   * would be one. Serialised on the Pilote's row, as the account's changes.
   */
  async update(tx: Tx, pilotId: string, projectId: string, patch: ProjectSettingsPatch): Promise<{ settings: ProjectSettings; seq: bigint; branchesChanged: boolean }> {
    if (!zId.safeParse(projectId).success) throw projectNotFound();
    await this.settings.lock(tx, pilotId);
    const project = await tx.project.findFirst({
      where: { id: projectId },
      select: { integrationBranch: true, releaseBranch: true, settings: { select: { roles: true, notificationsPush: true, worktreeCommands: true } } },
    });
    if (!project) throw projectNotFound();
    const choices = roleChoices(patch);
    await validateRoleChoices(tx, await this.settings.account(pilotId, tx), choices, { nullable: () => true });
    const integration = patch.branches?.integration ?? project.integrationBranch;
    const release = patch.branches?.release ?? project.releaseBranch;
    if (integration === release) {
      const fields = Object.fromEntries(Object.keys(patch.branches ?? {}).map((branch) => [`branches.${branch}`, MESSAGES['settings.branches-same']]));
      throw new AppError(422, 'settings.branches-same', MESSAGES['settings.branches-same'], fields);
    }

    const overrides = overridesOf(project.settings);
    const roles: Record<string, unknown> = { ...overrides.roles };
    for (const [roleId, choice] of choices) {
      if (choice) roles[roleId] = choice;
      else delete roles[roleId];
    }
    const push = patch.notifications?.push === undefined ? (overrides.notifications.push ?? null) : patch.notifications.push;
    const sealed = patch.worktreeCommands === undefined ? (project.settings?.worktreeCommands ?? null) : patch.worktreeCommands;
    const row = { roles: roles as Prisma.InputJsonObject, notificationsPush: push, worktreeCommands: sealed === null ? Prisma.DbNull : (sealed as Prisma.InputJsonObject) };
    await tx.projectSettings.upsert({ where: { projectId }, create: { projectId, pilotId, ...row }, update: row });

    const branchesChanged = integration !== project.integrationBranch || release !== project.releaseBranch;
    if (branchesChanged) {
      const changed = await tx.project.update({ where: { id: projectId }, data: { integrationBranch: integration, releaseBranch: release }, select: PROJECT_VIEW });
      const seq = await this.events.write(tx, pilotId, 'project.upserted', toProject(changed));
      await tx.project.update({ where: { id: projectId }, data: { lastSeq: seq }, select: { id: true } });
    }
    const settings = await this.settings.project(pilotId, projectId, tx);
    if (!settings) throw projectNotFound();
    const seq = await this.events.write(tx, pilotId, 'settings.upserted', { projectSettings: settings });
    return { settings, seq, branchesChanged };
  }
}

/** `GET` and `PATCH /api/projects/:id/settings`: the Paramètres of a Projet. */
@Controller('projects/:id/settings')
export class ProjectSettingsController {
  constructor(
    private readonly settings: ProjectSettingsService,
    private readonly transactions: Transactions,
    private readonly changes: ProjectChanges,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Paramètres of the Projet.', type: ProjectSettingsDto })
  get(@Param('id') id: string): Promise<ProjectSettings> {
    return this.settings.get(currentPilotId(), id);
  }

  @Patch()
  @ZodResponse({ status: 200, description: 'The Paramètres of the Projet, once changed, with the seq of their settings.upserted.', type: ProjectSettingsUpdatedDto })
  async update(@Param('id') id: string, @Body() body: ProjectSettingsPatchDto): Promise<ProjectSettingsUpdated> {
    const pilotId = currentPilotId();
    // The `seq` the page carries is not read: the last change wins.
    const { seq: _seq, ...patch } = body;
    const { settings, seq, branchesChanged } = await this.transactions.run((tx) => this.settings.update(tx, pilotId, id, patch));
    // The Runner's Miroir learns the Projet's new integration branch (MIROIR-1).
    if (branchesChanged) this.changes.changed(pilotId);
    return { ...settings, seq: Number(seq) };
  }
}
