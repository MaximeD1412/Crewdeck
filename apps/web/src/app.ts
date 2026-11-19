import type { EmailLinkVerified, Me } from '@crewdeck/contracts';
import {
  Cadre,
  PageAToi,
  PageComposants,
  NoteIdeaDialog,
  PageConnexion,
  PageConnexionLien,
  PageDemarrage,
  PageIdees,
  PageParametres,
  PageParametresProjet,
  PageProcessEditor,
  PageProjets,
  PageRunner,
  RepositoryPicker,
  RoleSettings,
  Composer,
  PermissionRequest,
  Question,
  Session,
  SettingRow,
  type Skin,
} from '@crewdeck/sdk';
import passerelle from '@crewdeck/skin-passerelle';
import { dispatcher as pageDispatcher, type Dispatcher } from './actions/dispatcher.js';
import { createEditorActions } from './actions/process-editor.js';
import { me as readMe, requestLink as postLinkRequest, verifyLink as postLinkVerify } from './api/auth.js';
import type { Client } from './api/client.js';
import { ApiError, currentDeviceId, deviceRevoked, onDeviceRevoked } from './api/request.js';
import { updateSettings } from './api/settings.js';
import { createInPageBridge, type InPageBridge } from './bridge/in-page.js';
import { confirmProductAction } from './dialogs/confirm.js';
import { browserScanner, openApproveDevice, openNewDevice } from './dialogs/device-approval.js';
import { createClosedIdeas } from './closed-ideas.js';
import { createDeadline } from './deadline.js';
import { createGettingStarted, gettingStartedGuard } from './getting-started.js';
import { followVault } from './keys/follow.js';
import { createPageKeys, type PageKeys } from './keys/index.js';
import { createEditorUi } from './process/editor-ui.js';
import { createNoteIdea } from './note-idea.js';
import { createProjectSettings } from './project-settings.js';
import { createProjects } from './projects.js';
import { bootSkin } from './registry.js';
import { createDeviceStore } from './keys/device-store.js';
import { createRoleSettings } from './role-settings.js';
import { createSessionPanel } from './session-panel.js';
import { createSessionPeek } from './sessions/peek.js';
import { createSessionRelay, type SessionRelay } from './sessions/relay.js';
import { routeData, routeSlots, startRouter, type Route, type RouteMatch, type Router } from './router.js';
import { aToiHref, composantsHref, ideesHref, ROUTES } from './routes.js';
import { mountShell } from './shell.js';
import { HOME_PATH, providerSignInHref, signInGuard } from './sign-in.js';
import { client as pageClient, connection as pageConnection, store as pageStore } from './store/index.js';
import type { Connection } from './store/connection.js';
import { createIdeaPlaintext } from './store/idea-plaintext.js';
import { createLatencyMeter, type LatencyMeter } from './store/latency.js';
import type { Store } from './store/store.js';
import { aToiView } from './views/a-toi.js';
import { createConnexion } from './views/connexion.js';
import { createConnexionLien, takeLinkToken } from './views/connexion-lien.js';
import { actionsOf, decisionViews } from './views/decisions/registry.js';
import './views/decisions/agent-question.js';
import './views/decisions/loop-back-exhausted.js';
import './views/decisions/permission-requested.js';
import './views/decisions/runner-offline.js';
import { systemOfBrowser } from './views/demarrage.js';
import { ADD_DEVICE_ID, isLastTrusted, revokeConfirmation, revokedDeviceOf } from './views/devices.js';
import { ideesQuery, ideesView } from './views/idees.js';
import { parametresView, timeZones } from './views/parametres.js';
import { parametresProjetView, type ParametresProjetView } from './views/parametres-projet.js';
import { processEditorView } from './views/process-editor.js';
import { projetsView } from './views/projets.js';
import { runnerView } from './views/runner.js';
import { roleName } from './views/session.js';
import { usageChangesAt } from './views/usage.js';

/** The Skins the page knows, by id: at the MVP, the default one. */
const SKINS: Readonly<Record<string, Skin>> = { passerelle };

const resolveSkin = (id: string): Skin => {
  const skin = Object.hasOwn(SKINS, id) ? SKINS[id] : undefined;
  if (!skin) throw new Error(`Skin ${id} inconnu`);
  return skin;
};

export interface BootOptions {
  readonly root: HTMLElement;
  readonly skin?: Skin;
  readonly routes?: readonly Route[];
  readonly dispatcher?: Dispatcher;
  /** The Pilote signed in, `null` without a session: `GET /api/me` by default. */
  readonly me?: () => Promise<Me | null>;
  /** Leaves the page for another document (the GitHub sign-in, the page signed in): `location.assign` by default. */
  readonly leave?: (url: string) => void;
  /** The sign-in by email (`api/auth.ts`): `POST /api/auth/email` and `/api/auth/email/verify` by default. */
  readonly requestLink?: (email: string, next: string) => Promise<void>;
  readonly verifyLink?: (token: string, timeZone: string) => Promise<EmailLinkVerified>;
  /** The page's store and its socket (`store/index.ts`) by default. */
  readonly store?: Store;
  readonly connection?: Pick<Connection, 'start' | 'stop'> & Partial<Pick<Connection, 'refresh'>>;
  /** The page's queries and commands (`store/index.ts`) by default. */
  readonly client?: Pick<Client, 'command' | 'query'>;
  /** The latency the page measures on its store's live events (CORE-8): started with the socket. */
  readonly latency?: LatencyMeter;
  /**
   * This browser's Appareil, the vault (E2E-2), a new Appareil's approval
   * (E2E-3), the vault key's rotation and a revoked Appareil forgotten
   * (E2E-4): IndexedDB and WebCrypto by default.
   */
  readonly keys?: Pick<PageKeys, 'linkKeys' | 'vault' | 'nameDevice' | 'unlockVault' | 'approval' | 'rotateVault' | 'forgetDevice'>;
  /** The relay of the Sessions (SESSION-1): through the page's socket, with this browser's Appareil, by default. */
  readonly relay?: Pick<SessionRelay, 'openSession' | 'sendInput' | 'closeSession'>;
}

export interface App {
  readonly router: Router;
  readonly bridge: InPageBridge;
  readonly dispatcher: Dispatcher;
  /** Stops the router, the socket and what listens (the tests). */
  readonly stop: () => void;
}

/**
 * The page's boot, once the tokens' CSS is loaded (`main.ts`): the Skin and
 * its parents defined under the `cd-*` tags, the `cd-action` dispatcher on the
 * document, the Pilote signed in (a Pilote it cannot read counts as signed
 * out), the Cadre in `root`, then the router rendering the current page into
 * the Cadre behind the sign-in's guard, and the actions that only move
 * between pages.
 */
export const boot = async ({
  root,
  skin = passerelle,
  routes = ROUTES,
  dispatcher = pageDispatcher,
  me = readMe,
  leave = (url) => location.assign(url),
  requestLink = postLinkRequest,
  verifyLink = postLinkVerify,
  store = pageStore,
  connection = pageConnection,
  client = pageClient,
  latency = createLatencyMeter({ store }),
  keys = createPageKeys({ store, client, userAgent: navigator.userAgent }),
  relay = createSessionRelay({ socket: pageConnection, devices: createDeviceStore() }),
}: BootOptions): Promise<App> => {
  // A sign-in link's token leaves the address bar before anything else (ADR 0014).
  const linkToken = takeLinkToken();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [pilot] = await Promise.all([me().catch(() => null), bootSkin(skin, resolveSkin)]);
  dispatcher.listen(document);
  const bridge = createInPageBridge({ dispatch: dispatcher.dispatch });
  // The Pilote of `/api/me` until the snapshot gives the store's.
  const unlockVault = () => keys.unlockVault();
  const shell = mountShell({
    root,
    // The router is started below, before any Banner can be clicked.
    navigate: (url) => router.navigate(url),
    state: () => {
      const state = store.getState();
      return { ...state, slices: { ...state.slices, pilot: state.slices.pilot !== undefined ? state.slices.pilot : pilot } };
    },
    // « Approuver cet Appareil »: this browser's code, until a trusted Appareil or the Runner approves it.
    onBannerAction: (key) => {
      if (key === 'device') openNewDevice({ approval: keys.approval, store, unlockVault });
    },
  });
  /**
   * « Retirer » an Appareil (E2E-4): the core's dialog says what happens, then
   * the revocation with the store's `seq`; this browser's own forgets its keys
   * (the Banner of a browser without an Appareil then shows). The request
   * says whether the dialog warned of the last trusted Appareil (OPS-1): when
   * another revocation left it the last meanwhile (409
   * `devices.last-changed`), the dialog asks again, with the warning. Any
   * other refusal is shown as any other (`unhandledrejection`).
   */
  const revokeDevice = async (deviceId: string, { warned = false } = {}): Promise<void> => {
    const currentId = currentDeviceId();
    const devices = store.getState().slices.device;
    const last = warned || isLastTrusted(devices, deviceId);
    const asked = revokeConfirmation(devices, deviceId, currentId, { last });
    if (!asked || !(await confirmProductAction(asked))) return;
    try {
      await client.command('POST', `/api/devices/${encodeURIComponent(deviceId)}/revoke`, { last });
    } catch (error) {
      if (!last && error instanceof ApiError && error.code === 'devices.last-changed') return revokeDevice(deviceId, { warned: true });
      throw error;
    }
    if (deviceId === currentId) await keys.forgetDevice();
  };
  // This browser's Appareil revoked (a 422 `devices.revoked`, the socket's 4403, its `device.upserted`): its keys forgotten.
  onDeviceRevoked(() => keys.forgetDevice());
  // The core's buttons in the Appareils' Card: « Ajouter un Appareil » approves another one, « Retirer » revokes one.
  const onOutletClick = (event: MouseEvent) => {
    const ids = event.composedPath().flatMap((target) => (target instanceof HTMLElement && target.id ? [target.id] : []));
    const revoked = ids.map(revokedDeviceOf).find((id) => id !== null);
    if (revoked) return void revokeDevice(revoked);
    if (!ids.includes(ADD_DEVICE_ID)) return;
    openApproveDevice({ approval: keys.approval, vaultState: () => store.getState().vaultState, scanner: browserScanner() });
  };
  shell.outlet.addEventListener('click', onOutletClick);
  const onUnhandled = (event: PromiseRejectionEvent) => {
    if (!(event.reason instanceof ApiError)) return;
    event.preventDefault();
    shell.showError(event.reason.message);
  };
  window.addEventListener('unhandledrejection', onUnhandled);
  const gettingStarted = createGettingStarted({
    store,
    client,
    bootPilot: pilot,
    origin: location.origin,
    system: systemOfBrowser(navigator.userAgent),
    keys: keys.linkKeys,
    unlockVault,
  });
  const connexion = createConnexion({ requestLink });
  const connexionLien = createConnexionLien({
    token: linkToken,
    timeZone,
    verifyLink,
    leave: (url) => leave(url),
    navigate: (url) => router.navigate(url),
  });
  const projects = createProjects({ store, client });
  const closedIdeas = createClosedIdeas({ client });
  // The boot's opening of the vault: until it settles, an Idée's text is « Déchiffrement… », not unreadable.
  let vaultTried: () => void = () => undefined;
  const plaintext = createIdeaPlaintext({
    vault: keys.vault,
    vaultState: () => store.getState().vaultState,
    settled: new Promise<void>((resolve) => {
      vaultTried = resolve;
    }),
  });
  const noteIdea = createNoteIdea({ client, vault: keys.vault, store });
  const noteDialog = document.createElement(NoteIdeaDialog.tag) as HTMLElement & { data: unknown };
  noteDialog.data = noteIdea.view();
  shell.append(noteDialog);
  const roleSettings = createRoleSettings({ client });
  /** The page without its `?session=`: the panel closed. */
  const closePanel = () => {
    const url = new URL(location.href);
    url.searchParams.delete('session');
    router.navigate(url.pathname + url.search + url.hash);
  };
  // What « À toi » reads of a Session's request, from the Runner (SESSION-3).
  const peek = createSessionPeek({ relay });
  const sessionPanel = createSessionPanel({ store, client, relay, shell, navigate: (url) => router.navigate(url), close: closePanel });
  const projectSettings = createProjectSettings({
    client,
    vault: keys.vault,
    stored: { seq: () => store.getState().seq, subscribe: (fn) => store.subscribe(() => fn()) },
  });
  /** A Projet's Paramètres from the store and the page's own state; `null` until the store has the Projet and the settings. */
  const projetParametres = (match: RouteMatch): ParametresProjetView | null => {
    const { slices, vaultState } = store.getState();
    const project = slices.project?.get(match.params['id'] ?? '');
    if (!project || !slices.settings) return null;
    const own = slices.settings.projects.find((candidate) => candidate.projectId === project.id);
    // Its Étapes are the Gestion du process' (PROCESS-7).
    const processHref = `/projets/${encodeURIComponent(project.id)}/process`;
    return parametresProjetView({
      project,
      settings: slices.settings,
      accounts: [...(slices['ai-account']?.values() ?? [])],
      local: projectSettings.view(project.id, own?.worktreeCommands ?? null, vaultState),
      processHref,
    });
  };
  // « Gestion du process »' own state: its view per Projet, the block to centre (PROCESS-7).
  const editorUi = createEditorUi();
  const signIn = signInGuard(pilot);
  // A Projet the store does not have once the snapshot is there (removed, another Pilote's): the Projets.
  const projectGuard = (match: RouteMatch): string | null => {
    if (match.composant !== PageParametresProjet) return null;
    const { seq, slices } = store.getState();
    return seq !== null && slices.project && !slices.project.has(match.params['id'] ?? '') ? '/projets' : null;
  };
  const started = gettingStartedGuard(gettingStarted.pilot);
  const pageData = routeData(routes, () => store.getState());
  const pageSlots = routeSlots(routes, () => store.getState());
  const router = startRouter({
    routes,
    outlet: shell.outlet,
    state: () => store.getState(),
    onRoute: (match) => {
      shell.update(match);
      sessionPanel.show(match.panel.session);
    },
    guard: (match) => started(match) ?? signIn(match) ?? projectGuard(match),
    slots: (match) => {
      if (match.composant === PageParametresProjet) return projetParametres(match)?.slots ?? [];
      if (match.composant !== PageParametres) return pageSlots(match);
      const { slices } = store.getState();
      return parametresView(slices.settings, timeZones(), {
        accounts: [...(slices['ai-account']?.values() ?? [])],
        local: roleSettings.view(),
        projects: [...(slices.project?.values() ?? [])],
        devices: slices.device,
        currentDeviceId: currentDeviceId(),
      });
    },
    data: (match) => {
      if (match.composant === PageParametresProjet) {
        const project = store.getState().slices.project?.get(match.params['id'] ?? '');
        return projetParametres(match)?.data ?? { project: project?.displayName ?? '', changedCount: 0, counts: {} };
      }
      if (match.composant === PageDemarrage) return { ...gettingStarted.view(), picker: projects.picker('demarrage') };
      if (match.composant === PageConnexion) return connexion.view(match.query);
      if (match.composant === PageConnexionLien) return connexionLien.view();
      if (match.composant === RepositoryPicker) return projects.picker('projets');
      const { slices } = store.getState();
      if (match.composant === PageAToi) {
        return aToiView(slices.decision?.values() ?? [], match.query, {
          runnerOnline: slices.runner?.state === 'online',
          sessionEvent: peek.read,
          roleName: (role) => roleName(role, slices.settings),
        });
      }
      if (match.composant === PageProjets) return projetsView(slices.project?.values() ?? []);
      if (match.composant === PageProcessEditor) {
        const projectId = match.params['id'] ?? '';
        return processEditorView(store.getState(), projectId, editorUi.view(projectId, match.query));
      }
      if (match.composant === PageIdees) {
        // The Idées merged or rejected beyond the slice's 90 days: their first page as the page first shows.
        closedIdeas.ensure();
        return ideesView(slices, (idea) => plaintext.text(idea), { ...ideesQuery(match.query), closed: closedIdeas.view() });
      }
      if (match.composant !== PageRunner) return pageData(match);
      return runnerView({
        runner: slices.runner ?? null,
        accounts: slices['ai-account']?.values() ?? [],
        mcpServers: slices['mcp-server']?.values() ?? [],
      });
    },
  });
  // The usage of the Comptes IA changes at a window's reset and a month's end, a new measure or not.
  const usageChanges = createDeadline(
    (now) => usageChangesAt(store.getState().slices.usage?.values() ?? [], now),
    () => router.refresh(),
  );
  usageChanges.schedule();
  // The Cadre and the page follow the store: a change made elsewhere shows without a reload.
  const refreshNoteDialog = () => {
    noteDialog.data = noteIdea.view();
  };
  // The Runner back: the reads of « À toi » it failed are tried again.
  let runnerOnline = store.getState().slices.runner?.state === 'online';
  const unsubscribe = [
    store.subscribe(() => {
      const online = store.getState().slices.runner?.state === 'online';
      if (online && !runnerOnline) peek.retry();
      runnerOnline = online;
      gettingStarted.sync();
      router.refresh();
      shell.refresh();
      usageChanges.schedule();
      refreshNoteDialog();
    }),
    plaintext.subscribe(() => router.refresh()),
    peek.subscribe(() => router.refresh()),
    noteIdea.subscribe(refreshNoteDialog),
    gettingStarted.subscribe(() => router.refresh()),
    connexion.subscribe(() => router.refresh()),
    connexionLien.subscribe(() => router.refresh()),
    projects.subscribe(() => router.refresh()),
    closedIdeas.subscribe(() => router.refresh()),
    roleSettings.subscribe(() => router.refresh()),
    projectSettings.subscribe(() => router.refresh()),
    editorUi.subscribe(() => router.refresh()),
  ];
  // The vault's version and rotation (E2E-4): a new version opened, a pending rotation run, the state read again after either.
  const stopFollowingVault = followVault({
    store,
    vault: keys.vault,
    unlockVault,
    rotateVault: () => keys.rotateVault(),
    refresh: () => connection.refresh?.(),
    currentDeviceId,
    forgetDevice: deviceRevoked,
  });
  if (pilot) {
    // The Appareil named before the snapshot, which says which one is `current`.
    await keys.nameDevice();
    void keys.unlockVault().finally(vaultTried);
    latency.start();
    connection.start();
  }
  if (!pilot) vaultTried();
  dispatcher.registerAction(PageConnexion, 'signInWith', {
    run: ({ provider }) => leave(providerSignInHref(provider, router.current.query['next'], timeZone)),
  });
  dispatcher.registerAction(PageConnexion, 'requestLink', {
    run: ({ email }) => connexion.requestLink(email, router.current.query['next'] ?? HOME_PATH),
  });
  dispatcher.registerAction(PageConnexion, 'changeEmail', { run: () => connexion.changeEmail() });
  dispatcher.registerAction(PageConnexionLien, 'confirm', { run: () => connexionLien.confirm() });
  dispatcher.registerAction(PageConnexionLien, 'restart', { run: () => connexionLien.restart() });
  dispatcher.registerAction(PageComposants, 'select', { run: ({ name }) => router.navigate(composantsHref(name)) });
  dispatcher.registerAction(PageParametres, 'change', {
    run: async ({ name, value }) => {
      if (name === 'timeZone' && typeof value === 'string') await updateSettings(client, { timeZone: value });
    },
  });
  dispatcher.registerAction(RoleSettings, 'choose', { run: ({ roleId, engine, model }) => roleSettings.choose(roleId, { engine, model }) });
  dispatcher.registerAction(RoleSettings, 'remove', { run: ({ roleId }) => roleSettings.remove(roleId) });
  dispatcher.registerAction(RoleSettings, 'add', { run: () => roleSettings.open() });
  dispatcher.registerAction(RoleSettings, 'create', { run: (body) => roleSettings.create(body) });
  dispatcher.registerAction(RoleSettings, 'cancel', { run: () => roleSettings.cancel() });
  const currentProject = (): string | null => (router.current.composant === PageParametresProjet ? (router.current.params['id'] ?? null) : null);
  dispatcher.registerAction(PageParametresProjet, 'change', {
    run: ({ name, value }) => {
      const projectId = currentProject();
      return projectId ? projectSettings.change(projectId, name, value) : undefined;
    },
  });
  dispatcher.registerAction(SettingRow, 'revert', {
    run: ({ name }) => {
      const projectId = currentProject();
      return projectId ? projectSettings.revert(projectId, name) : undefined;
    },
  });
  dispatcher.registerAction(Cadre, 'openPilot', { run: () => router.navigate('/parametres') });
  const openDecision = (id: string) => store.getState().slices.decision?.get(id);
  dispatcher.registerAction(PageAToi, 'filter', { run: ({ projectId }) => router.navigate(aToiHref(projectId)) });
  dispatcher.registerAction(PageAToi, 'open', {
    run: ({ id }) => {
      const decision = openDecision(id);
      if (decision) router.navigate(decision.link);
    },
  });
  // A Décision is answered by its module's command, never here (ATOI-1): the kind's view runs its button.
  dispatcher.registerAction(PageAToi, 'act', {
    run: ({ id, action }) => {
      const decision = openDecision(id);
      const button = decision && actionsOf(decisionViews.viewOf(decision.kind), decision).find((candidate) => candidate.id === action);
      if (!decision || !button) return;
      if (button.needsRunner && store.getState().slices.runner?.state !== 'online') return;
      return button.run(decision, { navigate: (url) => router.navigate(url), client });
    },
  });
  dispatcher.registerAction(PageAToi, 'note-idea', { run: () => noteIdea.open(null) });
  const ideesFilter = () => ideesQuery(router.current.query);
  dispatcher.registerAction(PageIdees, 'note', { run: () => noteIdea.open(ideesFilter().projectFilter) });
  dispatcher.registerAction(PageIdees, 'filter', { run: ({ projectId }) => router.navigate(ideesHref(projectId, ideesFilter().tab)) });
  dispatcher.registerAction(PageIdees, 'more', { run: () => closedIdeas.more() });
  dispatcher.registerAction(PageIdees, 'tab', { run: ({ tab }) => router.navigate(ideesHref(ideesFilter().projectFilter, tab)) });
  // The Idée's page (`/idees/:id`) and its analysis beside the list come with their tickets: a row leads nowhere yet.
  dispatcher.registerAction(PageIdees, 'open', { run: () => undefined });
  dispatcher.registerAction(NoteIdeaDialog, 'submit', { run: (input) => noteIdea.submit(input) });
  dispatcher.registerAction(NoteIdeaDialog, 'cancel', { run: () => noteIdea.cancel() });
  dispatcher.registerAction(PageDemarrage, 'selectSystem', { run: ({ system }) => gettingStarted.selectSystem(system) });
  dispatcher.registerAction(PageDemarrage, 'retry', { run: () => gettingStarted.retry() });
  dispatcher.registerAction(PageDemarrage, 'continue', { run: () => gettingStarted.advance() });
  const editor = createEditorActions({ ui: editorUi, navigate: (url, options) => router.navigate(url, options), current: () => router.current });
  dispatcher.registerAction(PageProcessEditor, 'select', { run: (payload) => editor.select(payload) });
  dispatcher.registerAction(PageProcessEditor, 'tab', { run: (payload) => editor.tab(payload) });
  dispatcher.registerAction(PageProcessEditor, 'view', { run: (payload) => editor.view(payload) });
  dispatcher.registerAction(PageProjets, 'add', { run: () => router.navigate('/projets/ajouter') });
  // In « Premiers pas » the Projets followed end it; on `/projets/ajouter` the list shows them.
  dispatcher.registerAction(RepositoryPicker, 'follow', {
    run: async ({ repositoryIds }) => {
      await projects.follow(repositoryIds);
      if (router.current.composant === PageDemarrage) await gettingStarted.advance();
      else router.navigate('/projets');
    },
  });
  dispatcher.registerAction(Session, 'stop', { run: () => sessionPanel.stop() });
  dispatcher.registerAction(Session, 'resume', { run: () => sessionPanel.resume() });
  dispatcher.registerAction(Session, 'close', { run: closePanel });
  // « Agrandir » is not at the MVP: the panel does not offer it.
  dispatcher.registerAction(Session, 'expand', { run: () => undefined });
  dispatcher.registerAction(Composer, 'send', { run: ({ text }) => sessionPanel.send(text) });
  // The agent's requests in the panel (SESSION-3): sealed to the Runner, which hands them to the Moteur once.
  dispatcher.registerAction(Question, 'answer', { run: ({ questionId, optionIds }) => sessionPanel.answer(questionId, optionIds) });
  dispatcher.registerAction(PermissionRequest, 'allow', { run: ({ id }) => sessionPanel.permission(id, 'allow') });
  dispatcher.registerAction(PermissionRequest, 'allowForSession', { run: ({ id }) => sessionPanel.permission(id, 'allow-session') });
  dispatcher.registerAction(PermissionRequest, 'deny', { run: ({ id }) => sessionPanel.permission(id, 'deny') });
  const stop = () => {
    sessionPanel.dispose();
    stopFollowingVault();
    onDeviceRevoked(null);
    router.stop();
    usageChanges.stop();
    connection.stop();
    latency.stop();
    for (const stopListening of unsubscribe) stopListening();
    window.removeEventListener('unhandledrejection', onUnhandled);
    shell.outlet.removeEventListener('click', onOutletClick);
  };
  return { router, bridge, dispatcher, stop };
};
