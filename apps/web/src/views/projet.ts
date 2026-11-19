import type { Project, ReadinessCheck, ReadinessCheckId } from '@crewdeck/contracts';
import { t, type ComposantData, type MessageKey, type PageProjet, type PageProjets } from '@crewdeck/sdk';
import { ajouterHref, projetHref } from '../routes.js';

/**
 * A Projet's readiness as its page and the list show it (PROJET-3, pure):
 * each check's row, its copy from its state and facts, the PageHeader's
 * count, the caution Banner's text, and the list's tone and badge.
 */

export type ReadinessView = ComposantData<typeof PageProjet>['readiness'];
type Row = ReadinessView['rows'][number];
type ListItem = ComposantData<typeof PageProjets>['projects'][number];

/** The name of a Rôle, a default one's or the Pilote's own (`views/session.ts`, `roleName`). */
export type RoleNameOf = (roleId: string) => string;

type Facts = ReadinessCheck['facts'];

const text = (facts: Facts, key: string): string | null => {
  const value = facts[key];
  return typeof value === 'string' ? value : null;
};
const count = (facts: Facts, key: string): number => {
  const value = facts[key];
  return typeof value === 'number' ? value : 0;
};
const machineOf = (facts: Facts): string => text(facts, 'machine') ?? t('projets.local.thisMachine');
const branchesOf = (facts: Facts) => ({ release: text(facts, 'release') ?? '', integration: text(facts, 'integration') ?? '' });

const settingsHref = (projectId: string): string => `${projetHref(projectId)}/parametres`;
const processHref = (projectId: string): string => `${projetHref(projectId)}/process`;

/** The Rôles each with its Moteur, the consecutive ones on the same Moteur together: « Idée, Conception : Claude Code · Code : Codex ». */
const enginesMeta = (facts: Facts, roleName: RoleNameOf): string => {
  const groups: { engine: string; roles: string[] }[] = [];
  for (const [roleId, engine] of Object.entries(facts)) {
    if (typeof engine !== 'string') continue;
    const last = groups.at(-1);
    if (last?.engine === engine) last.roles.push(roleName(roleId));
    else groups.push({ engine, roles: [roleName(roleId)] });
  }
  if (groups.length === 0) return t('projet.readiness.engines.none');
  return groups.map(({ engine, roles }) => t('projet.readiness.engines.group', { roles: roles.join(', '), engine: t(`engine.${engine}` as MessageKey) })).join(' · ');
};

const unusableRoles = (facts: Facts, roleName: RoleNameOf): string =>
  Object.entries(facts)
    .filter(([, engine]) => engine === null)
    .map(([roleId]) => roleName(roleId))
    .join(', ');

const toolsMeta = (facts: Facts): string => {
  const parts: string[] = [];
  const missing = text(facts, 'mcpMissing');
  const failed = text(facts, 'mcpFailed');
  if (missing) parts.push(t('projet.readiness.tools.mcp-missing', { names: missing }));
  if (failed) parts.push(t('projet.readiness.tools.mcp-failed', { names: failed }));
  if (facts['githubUnavailable'] === true) parts.push(t('projet.readiness.tools.github-unavailable'));
  return parts.length === 0 ? t('projet.readiness.tools.ok') : parts.join(' · ');
};

const FOLDER_ERRORS = ['folder-missing', 'git-failed', 'git-identity-missing'] as const;

/** The folder's line: where it stands, what « Corriger » does, or the last preparation's error. */
const folderMeta = (check: ReadinessCheck): string => {
  const { facts } = check;
  const machine = machineOf(facts);
  const reason = text(facts, 'reason');
  if (check.state === 'ok') return t('projet.readiness.folder.ok', { machine });
  if (reason === 'preparing') return t('projet.readiness.folder.preparing', { machine });
  if (reason === 'waiting') return t('projet.readiness.folder.waiting', { machine });
  if (reason === 'missing') return t('projet.readiness.folder.missing', { machine });
  const error = FOLDER_ERRORS.find((candidate) => candidate === text(facts, 'error'));
  if (error) return t(`projet.readiness.folder.error.${error}`, { machine });
  const branches = branchesOf(facts);
  if (reason === 'not-git') return t('projet.readiness.folder.not-git');
  if (reason === 'no-commit') return t('projet.readiness.folder.no-commit', branches);
  if (reason === 'no-release') return t('projet.readiness.folder.no-release', branches);
  return t('projet.readiness.folder.no-integration', branches);
};

const processMeta = ({ state, facts }: ReadinessCheck): string => {
  if (state === 'ok') {
    const template = text(facts, 'templateName');
    const version = count(facts, 'version');
    return template ? t('projet.readiness.process.ok.template', { version, template }) : t('projet.readiness.process.ok', { version });
  }
  const gaps = count(facts, 'gaps');
  if (gaps === 0) return t('projet.readiness.process.draft');
  return gaps === 1 ? t('projet.readiness.process.missing.one') : t('projet.readiness.process.missing.many', { count: gaps });
};

const INVENTORY_WORDS = ['drafting', 'to-approve', 'awaiting-merge'] as const;

const inventoryMeta = ({ state, facts }: ReadinessCheck): string => {
  if (state === 'ok') return t('projet.readiness.inventory.ok');
  const word = INVENTORY_WORDS.find((candidate) => candidate === text(facts, 'state'));
  return word ? t(`projet.readiness.inventory.${word}`) : t('projet.readiness.inventory.other');
};

const metaOf = (check: ReadinessCheck, roleName: RoleNameOf): string => {
  const { facts, state } = check;
  switch (check.id) {
    case 'runner-linked':
      if (state !== 'ok') return t('projet.readiness.runner-linked.missing');
      return facts['online'] === true ? t('projet.readiness.runner-linked.online', { machine: machineOf(facts) }) : t('projet.readiness.runner-linked.offline', { machine: machineOf(facts) });
    case 'folder':
      return folderMeta(check);
    case 'engines':
      return state === 'ok' ? enginesMeta(facts, roleName) : t('projet.readiness.engines.missing', { roles: unusableRoles(facts, roleName) });
    case 'tools':
      return toolsMeta(facts);
    case 'process':
      return processMeta(check);
    case 'labels': {
      if (state === 'pending') return t('projet.readiness.github.pending');
      const missing = count(facts, 'missing');
      if (missing === 0) return t('projet.readiness.labels.ok');
      return missing === 1 ? t('projet.readiness.labels.missing.one') : t('projet.readiness.labels.missing.many', { count: missing });
    }
    case 'branches':
      if (state === 'pending') return t('projet.readiness.github.pending');
      if (state === 'ok') return t('projet.readiness.branches.ok', branchesOf(facts));
      return facts['releaseExists'] === false ? t('projet.readiness.branches.missing.release', branchesOf(facts)) : t('projet.readiness.branches.missing.auto', branchesOf(facts));
    case 'inventory':
      return inventoryMeta(check);
  }
};

/** Where a check is fixed when the page cannot: the « Process » row always leads to its Gestion du process. */
const hrefOf = (check: ReadinessCheck, projectId: string): string | null => {
  if (check.id === 'process') return processHref(projectId);
  if (check.state !== 'missing') return null;
  const reason = text(check.facts, 'reason');
  switch (check.id) {
    case 'runner-linked':
    case 'tools':
      return '/runner';
    case 'engines':
      return settingsHref(projectId);
    case 'folder':
      if (reason === 'missing') return ajouterHref(projectId);
      return reason === 'no-release' ? settingsHref(projectId) : null;
    case 'branches':
      return check.fix === null ? settingsHref(projectId) : null;
    default:
      return null;
  }
};

/** The kind of a missing check, which names its Banner's text and its short words in the list. */
const missingKind = (check: ReadinessCheck): string => {
  const reason = text(check.facts, 'reason');
  if (check.id === 'folder') return reason === 'missing' ? 'folder.missing' : reason === 'no-release' ? 'folder.release' : 'folder.auto';
  if (check.id === 'branches') return check.fix === 'auto' ? 'branches.auto' : 'branches.release';
  return check.id;
};

const blockedOf = (check: ReadinessCheck, roleName: RoleNameOf): string => {
  const { facts } = check;
  const kind = missingKind(check);
  return t(`projet.readiness.blocked.${kind}` as MessageKey, {
    ...branchesOf(facts),
    machine: machineOf(facts),
    roles: unusableRoles(facts, roleName),
    detail: check.id === 'tools' ? toolsMeta(facts) : '',
  });
};

const rowOf = (check: ReadinessCheck, projectId: string, roleName: RoleNameOf): Row => ({
  id: check.id,
  state: check.state,
  title: t(`projet.readiness.title.${check.id}`),
  meta: metaOf(check, roleName),
  fix: check.state === 'missing' && check.fix === 'auto',
  href: hrefOf(check, projectId),
});

const missingOf = (project: Pick<Project, 'readiness'>): ReadinessCheck[] => project.readiness?.checks.filter((check) => check.state === 'missing') ?? [];

/** The Card « Ce dont le Process a besoin » and what goes with it: the checks in the server's order (missing first), `fixing` the check whose « Corriger » runs. */
export const readinessView = (project: Pick<Project, 'id' | 'readiness'>, { roleName, fixing }: { readonly roleName: RoleNameOf; readonly fixing: ReadinessCheckId | null }): ReadinessView => {
  const missing = missingOf(project);
  const first = missing[0];
  const ready = project.readiness?.ready === true;
  return {
    count: ready
      ? t('projet.readiness.count.ready')
      : missing.length === 0
        ? t('projet.readiness.count.waiting')
        : missing.length === 1
          ? t('projet.readiness.count.one')
          : t('projet.readiness.count.many', { count: missing.length }),
    blocked: first ? blockedOf(first, roleName) : null,
    rows: (project.readiness?.checks ?? []).map((check) => rowOf(check, project.id, roleName)),
    fixing,
  };
};

/**
 * A Projet's tone and badge in « Projets », and its meta when a point is to
 * fix: « prêt » (go), « à régler » (caution, « 1 point à régler : <first> »),
 * « inventaire » (accent) when only the Inventaire waits, « en cours » while
 * a check is read.
 */
export const readinessBadge = (project: Pick<Project, 'readiness'>, meta: string): Pick<ListItem, 'tone' | 'badge' | 'meta'> => {
  if (project.readiness?.ready === true) return { tone: 'go', badge: t('projet.readiness.list.badge.ready'), meta };
  const checks = project.readiness?.checks ?? [];
  const missing = checks.filter((check) => check.state === 'missing' && check.id !== 'inventory');
  const first = missing[0];
  if (first) {
    const words = t(`projet.readiness.short.${missingKind(first)}` as MessageKey);
    const all = missingOf(project).length;
    return {
      tone: 'caution',
      badge: t('projet.readiness.list.badge.missing'),
      meta: all === 1 ? t('projet.readiness.list.missing.one', { first: words }) : t('projet.readiness.list.missing.many', { count: all, first: words }),
    };
  }
  const inventory = checks.find((check) => check.id === 'inventory');
  const othersOk = checks.every((check) => check.id === 'inventory' || check.state === 'ok');
  if (inventory && inventory.state !== 'ok' && othersOk) return { tone: 'accent', badge: t('projet.readiness.list.badge.inventory'), meta: t('projet.readiness.list.inventory') };
  return { tone: 'neutral', badge: t('projet.readiness.list.badge.waiting'), meta };
};
