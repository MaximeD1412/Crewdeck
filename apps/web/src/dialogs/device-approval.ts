import { t } from '@crewdeck/sdk';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import QRCode from 'qrcode';
import { ApiError } from '../api/request.js';
import {
  deviceCodeText,
  deviceCodeUri,
  parseDeviceCode,
  type CheckedDevice,
  type DeviceApprovalKeys,
  type NewDeviceCode,
} from '../keys/approval.js';
import type { VaultState } from '../keys/vault.js';
import type { Store } from '../store/store.js';
import { activeElement, coreDialogStyles, icon } from './core.js';

/** The core's tags: not `cd-*` ones, so no Skin's Composant can claim them. */
export const NEW_DEVICE_TAG = 'crewdeck-new-device';
export const APPROVE_DEVICE_TAG = 'crewdeck-approve-device';

/** What the Pilote reads of a failed call: the API's French message, else the page's own. */
const messageOf = (error: unknown): string => (error instanceof ApiError ? error.message : t('api.unreadable'));

/** `9:05` for 545 s. */
const minutes = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const extraStyles = css`
  .lead {
    color: var(--cd-ink);
  }
  canvas {
    align-self: center;
    max-width: 100%;
    border-radius: var(--cd-radius);
  }
  .copy {
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-1);
  }
  .copy-line {
    display: flex;
    align-items: center;
    gap: var(--cd-space-2);
    padding: var(--cd-space-2) var(--cd-space-3);
    border-radius: var(--cd-radius);
    background: var(--cd-sunk);
  }
  code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--cd-ink);
    font: var(--cd-font-mono-weight) var(--cd-font-mono-size) / var(--cd-font-mono-line-height) var(--cd-font-mono-family), monospace;
  }
  .copy-line button {
    width: auto;
    height: auto;
    min-height: var(--cd-touch);
    padding: 0 var(--cd-space-3);
  }
  .muted {
    font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height) var(--cd-font-caption-family), sans-serif;
  }
  label {
    color: var(--cd-ink);
    font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height) var(--cd-font-label-family), sans-serif;
  }
  input {
    width: 100%;
    min-height: var(--cd-touch);
    margin: var(--cd-space-1) 0 0;
    padding: 0 var(--cd-space-3);
    border: thin solid var(--cd-line-strong);
    border-radius: var(--cd-radius);
    background: var(--cd-sunk);
    color: var(--cd-ink);
    font: var(--cd-font-mono-weight) var(--cd-font-mono-size) / var(--cd-font-mono-line-height) var(--cd-font-mono-family), monospace;
  }
  input:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
  input[aria-invalid='true'] {
    border-color: var(--cd-halt);
  }
  .error {
    color: var(--cd-halt);
  }
  video {
    width: 100%;
    border-radius: var(--cd-radius);
    background: var(--cd-sunk);
  }
`;

/**
 * What both approval dialogs share with `crewdeck-confirm`: a native modal
 * `<dialog>` marked « Approbation par Crewdeck », the focus moved into it and
 * given back to its opener, Escape the same as « Fermer ». A Skin can neither
 * replace nor restyle them, nor read the code they show or take.
 */
abstract class CoreDialog extends LitElement {
  static override styles = [coreDialogStyles, extraStyles];

  private opener: HTMLElement | null = null;
  private closedResolve!: () => void;
  /** Resolves once the dialog is closed. */
  readonly closed = new Promise<void>((resolve) => (this.closedResolve = resolve));

  protected abstract heading(): string;
  protected abstract body(): TemplateResult;
  protected abstract actions(): TemplateResult;
  /** Stops what the dialog started (a timer, a camera, a subscription). */
  protected abstract teardown(): void;

  protected get dialog(): HTMLDialogElement {
    const dialog = this.shadowRoot?.querySelector('dialog');
    if (!dialog) throw new Error(`${this.localName} is not rendered`);
    return dialog;
  }

  /** Opens it modal, the focus on its first control. */
  async open(): Promise<void> {
    this.opener = activeElement();
    await this.updateComplete;
    this.dialog.showModal();
    this.focusFirst();
  }

  protected focusFirst() {
    this.shadowRoot?.querySelector<HTMLElement>('input, .actions button')?.focus();
  }

  close = () => {
    if (!this.isConnected) return;
    this.teardown();
    this.dialog.close();
    this.remove();
    this.opener?.focus();
    this.opener = null;
    this.closedResolve();
  };

  private onCancel(event: Event) {
    event.preventDefault();
    this.close();
  }

  protected copyLine(text: string, label: string): TemplateResult {
    return html`<div class="copy">
      <span class="muted">${label}</span>
      <div class="copy-line">
        <code>${text}</code>
        <button type="button" class="ghost" @click=${(event: Event) => this.copy(event, text)}>${t('codeBlock.copy')}</button>
      </div>
    </div>`;
  }

  private async copy(event: Event, text: string) {
    const button = event.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(text);
    button.textContent = t('codeBlock.copied');
    setTimeout(() => (button.textContent = t('codeBlock.copy')), 2000);
  }

  protected override render() {
    return html`<dialog aria-modal="true" aria-labelledby="title" @cancel=${this.onCancel}>
      <div class="box">
        <div class="mark">${icon('key')}<span>${t('devices.mark')}</span></div>
        <h2 id="title">${this.heading()}</h2>
        <div class="body">${this.body()}</div>
        <div class="actions">${this.actions()}</div>
      </div>
    </dialog>`;
  }
}

export interface NewDeviceOptions {
  readonly approval: Pick<DeviceApprovalKeys, 'register' | 'adopt'>;
  /** The store's Appareils: the code's turning `trusted` is the approval. */
  readonly store: Pick<Store, 'getState' | 'subscribe'>;
  /** Opens the vault once the approval is adopted. */
  readonly unlockVault: () => Promise<VaultState>;
  readonly now?: () => number;
}

type NewDeviceStep =
  | { readonly kind: 'registering' }
  | { readonly kind: 'waiting'; readonly code: NewDeviceCode; readonly adopting: boolean }
  | { readonly kind: 'approved' | 'expired' | 'invalid' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * `crewdeck-new-device`: this browser asks to become an Appareil (US-60). It
 * registers a pending Appareil, shows its code as a QR code, as text and in
 * the Runner's command, and the time left; once the store says it is
 * `trusted`, it adopts the approval (the approver's proof checked) and opens
 * the vault: « Appareil approuvé ». Expired: « Code expiré » and
 * « Recommencer ».
 */
export class CrewdeckNewDevice extends CoreDialog {
  static override properties = { step: { state: true }, tick: { state: true } };

  declare options: NewDeviceOptions;
  declare step: NewDeviceStep;
  declare tick: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: (() => void) | undefined;
  private drawn: string | null = null;

  constructor() {
    super();
    this.step = { kind: 'registering' };
    this.tick = 0;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  override async open(): Promise<void> {
    await super.open();
    this.unsubscribe = this.options.store.subscribe(() => void this.follow());
    this.timer = setInterval(() => this.onTick(), 1000);
    await this.register();
  }

  protected override teardown() {
    clearInterval(this.timer);
    this.unsubscribe?.();
  }

  private async register() {
    this.step = { kind: 'registering' };
    this.drawn = null;
    try {
      const code = await this.options.approval.register();
      if (!this.isConnected) return;
      this.step = { kind: 'waiting', code, adopting: false };
      await this.follow();
    } catch (error) {
      this.step = { kind: 'failed', message: messageOf(error) };
    }
  }

  private onTick() {
    this.tick += 1;
    const step = this.step;
    if (step.kind === 'waiting' && !step.adopting && this.now() >= Date.parse(step.code.expiresAt)) this.step = { kind: 'expired' };
  }

  /** The code's Appareil `trusted` in the store: adopts the approval, then opens the vault. */
  private async follow() {
    const step = this.step;
    if (step.kind !== 'waiting' || step.adopting) return;
    if (this.options.store.getState().slices.device?.get(step.code.id)?.state !== 'trusted') return;
    this.step = { ...step, adopting: true };
    try {
      if ((await this.options.approval.adopt(step.code)) === 'invalid') {
        this.step = { kind: 'invalid' };
        return;
      }
      await this.options.unlockVault();
      this.step = { kind: 'approved' };
    } catch (error) {
      this.step = { kind: 'failed', message: messageOf(error) };
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const step = this.step;
    const canvas = this.shadowRoot?.querySelector('canvas');
    if (step.kind !== 'waiting' || !canvas) return;
    const uri = deviceCodeUri(step.code);
    if (this.drawn === uri) return;
    this.drawn = uri;
    // The library's black on white: what any camera reads, whatever the Skin's colours.
    void QRCode.toCanvas(canvas, uri, { width: 224, margin: 2, errorCorrectionLevel: 'M' });
  }

  protected heading(): string {
    switch (this.step.kind) {
      case 'approved':
        return t('devices.new.approved.title');
      case 'expired':
        return t('devices.new.expired.title');
      default:
        return t('devices.new.title');
    }
  }

  protected body(): TemplateResult {
    const step = this.step;
    switch (step.kind) {
      case 'registering':
        return html`<p role="status">${t('devices.new.registering')}</p>`;
      case 'approved':
        return html`<p role="status">${t('devices.new.approved.text')}</p>`;
      case 'expired':
        return html`<p role="status">${t('devices.new.expired.text')}</p>`;
      case 'invalid':
        return html`<p role="alert" class="error">${t('devices.new.invalid')}</p>`;
      case 'failed':
        return html`<p role="alert" class="error">${step.message}</p>`;
      case 'waiting': {
        const text = deviceCodeText(step.code);
        const left = Math.max(0, Math.ceil((Date.parse(step.code.expiresAt) - this.now()) / 1000));
        return html`<p class="lead">${t('devices.new.lead')}</p>
          <canvas role="img" aria-label=${t('devices.new.qr')}></canvas>
          ${this.copyLine(text, t('devices.new.code'))} ${this.copyLine(`crewdeck-runner appareils approuver ${text}`, t('devices.new.runner'))}
          <p class="muted">${t('devices.new.expires', { time: minutes(left) })}</p>
          <p role="status">${t('devices.new.waiting')}</p>`;
      }
    }
  }

  protected actions(): TemplateResult {
    const kind = this.step.kind;
    const retry = kind === 'expired' || kind === 'invalid' || kind === 'failed';
    return html`<button type="button" class=${kind === 'approved' ? 'primary' : 'ghost'} @click=${this.close}>${t('devices.close')}</button>
      ${retry ? html`<button type="button" class="primary" @click=${() => void this.register()}>${t('devices.new.retry')}</button>` : nothing}`;
  }
}

/** The camera reading a QR code: the text of the first one it sees. */
export interface Scanner {
  scan(video: HTMLVideoElement, signal: AbortSignal): Promise<string>;
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<readonly { rawValue: string }[]>;
}
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

/** The browser's camera and `BarcodeDetector`; `undefined` where it has no `BarcodeDetector` (« Scanner » then hidden). */
export const browserScanner = (target: Window = window): Scanner | undefined => {
  const Barcode = (target as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (!Barcode) return undefined;
  return {
    async scan(video, signal) {
      const stream = await target.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      try {
        video.srcObject = stream;
        await video.play();
        const detector = new Barcode({ formats: ['qr_code'] });
        while (!signal.aborted) {
          const [found] = await detector.detect(video);
          if (found) return found.rawValue;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw signal.reason;
      } finally {
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      }
    },
  };
};

export interface ApproveDeviceOptions {
  readonly approval: Pick<DeviceApprovalKeys, 'check' | 'approve'>;
  /** This browser's vault: only an opened one has a key to wrap. */
  readonly vaultState: () => VaultState;
  /** The camera; none hides « Scanner ». */
  readonly scanner?: Scanner | undefined;
}

type ApproveStep =
  | { readonly kind: 'locked' }
  | { readonly kind: 'enter'; readonly error: string | null; readonly busy: boolean }
  | { readonly kind: 'scan' }
  | { readonly kind: 'confirm'; readonly checked: CheckedDevice; readonly busy: boolean }
  | { readonly kind: 'done'; readonly name: string };

/**
 * `crewdeck-approve-device`: a trusted Appareil approves a new one (US-60).
 * The code scanned (where `BarcodeDetector` exists) or pasted; its pending
 * Appareil fetched and its proof checked; « Approuver « <name> » ? »; then
 * the vault key wrapped for it. An unknown, expired or used code says the
 * server's message.
 */
export class CrewdeckApproveDevice extends CoreDialog {
  static override properties = { step: { state: true } };

  declare options: ApproveDeviceOptions;
  declare step: ApproveStep;
  private value = '';
  private scanning: AbortController | undefined;

  constructor() {
    super();
    this.step = { kind: 'enter', error: null, busy: false };
  }

  override async open(): Promise<void> {
    this.step = this.options.vaultState() === 'unlocked' ? { kind: 'enter', error: null, busy: false } : { kind: 'locked' };
    await super.open();
  }

  protected override teardown() {
    this.scanning?.abort();
  }

  private async submit() {
    const step = this.step;
    if (step.kind !== 'enter' || step.busy) return;
    const code = parseDeviceCode(this.value);
    if (!code) {
      this.step = { kind: 'enter', error: t('devices.add.badCode'), busy: false };
      return;
    }
    this.step = { kind: 'enter', error: null, busy: true };
    try {
      const checked = await this.options.approval.check(code);
      this.step = checked === 'mismatch' ? { kind: 'enter', error: t('devices.add.mismatch'), busy: false } : { kind: 'confirm', checked, busy: false };
    } catch (error) {
      this.step = { kind: 'enter', error: messageOf(error), busy: false };
    }
    await this.updateComplete;
    this.focusFirst();
  }

  private async approve() {
    const step = this.step;
    if (step.kind !== 'confirm' || step.busy) return;
    this.step = { ...step, busy: true };
    try {
      await this.options.approval.approve(step.checked);
      this.step = { kind: 'done', name: step.checked.device.name };
    } catch (error) {
      this.step = { kind: 'enter', error: messageOf(error), busy: false };
    }
    await this.updateComplete;
    this.focusFirst();
  }

  private async scan() {
    const scanner = this.options.scanner;
    if (!scanner) return;
    this.step = { kind: 'scan' };
    await this.updateComplete;
    const video = this.shadowRoot?.querySelector('video');
    if (!video) return;
    const scanning = new AbortController();
    this.scanning = scanning;
    try {
      this.value = await scanner.scan(video, scanning.signal);
      this.step = { kind: 'enter', error: null, busy: false };
      await this.submit();
    } catch {
      if (scanning.signal.aborted) return;
      this.step = { kind: 'enter', error: t('devices.add.scanFailed'), busy: false };
    }
  }

  private stopScan() {
    this.scanning?.abort();
    this.step = { kind: 'enter', error: null, busy: false };
  }

  protected heading(): string {
    return this.step.kind === 'confirm' ? t('devices.add.confirm', { name: this.step.checked.device.name }) : t('devices.add.title');
  }

  protected body(): TemplateResult {
    const step = this.step;
    switch (step.kind) {
      case 'locked':
        return html`<p role="alert">${t('devices.add.locked')}</p>`;
      case 'scan':
        return html`<video muted playsinline aria-label=${t('devices.add.camera')}></video>`;
      case 'confirm':
        return html`<p>${t('devices.add.confirmText')}</p>`;
      case 'done':
        return html`<p role="status">${t('devices.add.approved', { name: step.name })}</p>`;
      case 'enter':
        return html`<p class="lead">${t('devices.add.lead')}</p>
          <form
            @submit=${(event: Event) => {
              event.preventDefault();
              void this.submit();
            }}
          >
            <label for="code">${t('devices.add.field')}</label>
            <input
              id="code"
              name="code"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              .value=${this.value}
              aria-invalid=${step.error ? 'true' : 'false'}
              aria-describedby=${step.error ? 'error' : nothing}
              @input=${(event: Event) => (this.value = (event.target as HTMLInputElement).value)}
            />
          </form>
          ${step.error ? html`<p id="error" role="alert" class="error">${step.error}</p>` : nothing}`;
    }
  }

  protected actions(): TemplateResult {
    const step = this.step;
    switch (step.kind) {
      case 'locked':
      case 'done':
        return html`<button type="button" class="primary" @click=${this.close}>${t('devices.close')}</button>`;
      case 'scan':
        return html`<button type="button" class="ghost" @click=${() => this.stopScan()}>${t('devices.cancel')}</button>`;
      case 'confirm':
        return html`<button type="button" class="ghost" @click=${this.close}>${t('devices.cancel')}</button>
          <button type="button" class="primary" ?disabled=${step.busy} @click=${() => void this.approve()}>
            ${icon('check')}<span>${t('devices.add.approve')}</span>
          </button>`;
      case 'enter':
        return html`<button type="button" class="ghost" @click=${this.close}>${t('devices.cancel')}</button>
          ${this.options.scanner
            ? html`<button type="button" class="ghost" @click=${() => void this.scan()}>${t('devices.add.scan')}</button>`
            : nothing}
          <button type="button" class="primary" ?disabled=${step.busy} @click=${() => void this.submit()}>${t('devices.add.continue')}</button>`;
    }
  }
}

// Defined when the core's modules evaluate, before any Skin's.
for (const [tag, element] of [
  [NEW_DEVICE_TAG, CrewdeckNewDevice],
  [APPROVE_DEVICE_TAG, CrewdeckApproveDevice],
] as const) {
  if (customElements.get(tag) !== undefined) throw new Error(`${tag} est déjà défini : il est réservé au cœur de Crewdeck.`);
  customElements.define(tag, element);
}

const opened = <T extends CoreDialog>(dialog: T): T => {
  document.querySelector<CoreDialog>(`${NEW_DEVICE_TAG}, ${APPROVE_DEVICE_TAG}`)?.close();
  document.body.append(dialog);
  void dialog.open();
  return dialog;
};

/** « Approuver cet Appareil »: this browser's code, until it is approved. */
export const openNewDevice = (options: NewDeviceOptions): CrewdeckNewDevice => {
  const dialog = new CrewdeckNewDevice();
  dialog.options = options;
  return opened(dialog);
};

/** « Ajouter un Appareil »: the approval of another one, from this trusted Appareil. */
export const openApproveDevice = (options: ApproveDeviceOptions): CrewdeckApproveDevice => {
  const dialog = new CrewdeckApproveDevice();
  dialog.options = options;
  return opened(dialog);
};
