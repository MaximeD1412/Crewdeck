/**
 * A fake Web Speech recognition for the tests: `installFakeSpeech()` puts it
 * on `window` as `SpeechRecognition` and `webkitSpeechRecognition`, and the
 * test drives it through `window.fakeSpeech` (what it hears, an error, the
 * browser's own end). `removeSpeech()` takes both away, a browser without the
 * API. Each is self-contained, so that Playwright runs it as an init script
 * (`page.addInitScript(installFakeSpeech)`), before the page's own code.
 */

/** What a test drives the fake with, `window.fakeSpeech`. */
export interface FakeSpeechControl {
  /** How many recognitions started, and whether the last one still listens. */
  readonly started: number;
  readonly listening: boolean;
  /** The settings of the last one started. */
  readonly settings: { readonly lang: string; readonly continuous: boolean; readonly interimResults: boolean } | null;
  /** Hears `text`: the utterance in progress (`final: false`), or its last words (`final: true`), after which a new one begins. */
  say(text: string, final: boolean): void;
  /** The browser's error (`not-allowed`, `no-speech`, `network`…), then its end. */
  fail(error: string): void;
  /** The browser ends the recognition by itself. */
  end(): void;
}

export const installFakeSpeech = (): void => {
  interface Utterance {
    transcript: string;
    isFinal: boolean;
  }
  let current: FakeSpeechRecognition | null = null;
  let started = 0;

  class FakeSpeechRecognition extends EventTarget {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    utterances: Utterance[] = [];
    listening = false;

    start(): void {
      if (current?.listening) throw new DOMException('La reconnaissance est déjà lancée.', 'InvalidStateError');
      this.listening = true;
      this.utterances = [];
      current = this;
      started += 1;
      this.dispatchEvent(new Event('start'));
    }

    stop(): void {
      this.finish();
    }

    abort(): void {
      this.finish();
    }

    finish(): void {
      if (!this.listening) return;
      this.listening = false;
      this.dispatchEvent(new Event('end'));
    }

    hear(text: string, isFinal: boolean): void {
      const last = this.utterances.at(-1);
      const index = last && !last.isFinal ? this.utterances.length - 1 : this.utterances.length;
      this.utterances[index] = { transcript: text, isFinal };
      const results = this.utterances.map((utterance) => Object.assign([{ transcript: utterance.transcript, confidence: 0.9 }], { isFinal: utterance.isFinal }));
      this.dispatchEvent(Object.assign(new Event('result'), { resultIndex: index, results }));
    }
  }

  const control: FakeSpeechControl = {
    get started() {
      return started;
    },
    get listening() {
      return current?.listening ?? false;
    },
    get settings() {
      return current && { lang: current.lang, continuous: current.continuous, interimResults: current.interimResults };
    },
    say(text, final) {
      if (current?.listening) current.hear(text, final);
    },
    fail(error) {
      if (!current?.listening) return;
      current.dispatchEvent(Object.assign(new Event('error'), { error, message: '' }));
      current.finish();
    },
    end() {
      current?.finish();
    },
  };
  Object.assign(window, { SpeechRecognition: FakeSpeechRecognition, webkitSpeechRecognition: FakeSpeechRecognition, fakeSpeech: control });
};

/** A browser without the Web Speech API: neither name on `window`. */
export const removeSpeech = (): void => {
  const speech = window as unknown as Record<string, unknown>;
  delete speech['SpeechRecognition'];
  delete speech['webkitSpeechRecognition'];
};

/** The fake's control, once installed. */
export const fakeSpeech = (): FakeSpeechControl => (window as unknown as { fakeSpeech: FakeSpeechControl }).fakeSpeech;
