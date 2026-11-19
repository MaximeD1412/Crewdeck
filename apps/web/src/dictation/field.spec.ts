import { DICTATION_NOTICE_KEY, createDictationField } from './field.js';
import { fakeSpeech, installFakeSpeech, removeSpeech } from './fake-speech.js';

const memory = (seen = false) => {
  const items = new Map<string, string>(seen ? [[DICTATION_NOTICE_KEY, 'vue']] : []);
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
};

const setup = (storage = memory()) => {
  let changes = 0;
  const field = createDictationField({ storage, onChange: () => (changes += 1) });
  return { field, storage, changes: () => changes };
};

describe('a dictated field', () => {
  beforeEach(() => installFakeSpeech());
  afterEach(() => {
    removeSpeech();
    vi.useRealTimers();
  });

  it('idle at first, available with the API, nothing dictated', () => {
    const { field } = setup();
    expect(field.view()).toEqual({ available: true, state: 'idle', elapsedSeconds: 0, error: null, notice: false });
    expect(field.text).toBe('');
    expect(field.dictated).toBe(false);
  });

  it('not available without the API', () => {
    removeSpeech();
    expect(setup().field.view().available).toBe(false);
  });

  it('puts the transcript, interim then final, after what the field held, and counts the seconds', () => {
    vi.useFakeTimers();
    const { field, changes } = setup();
    field.start('Une idée :');
    expect(field.view().state).toBe('dictating');
    expect(field.text).toBe('Une idée :');
    fakeSpeech().say('pouvoir dupliquer', false);
    expect(field.text).toBe('Une idée : pouvoir dupliquer');
    fakeSpeech().say('pouvoir dupliquer une recette', true);
    expect(field.text).toBe('Une idée : pouvoir dupliquer une recette');
    expect(field.dictated).toBe(true);
    const before = changes();
    vi.advanceTimersByTime(7_000);
    expect(field.view().elapsedSeconds).toBe(7);
    expect(changes()).toBeGreaterThanOrEqual(before + 7);
  });

  it('an empty field takes the transcript as is', () => {
    const { field } = setup();
    field.start('');
    fakeSpeech().say('Pouvoir dupliquer', false);
    expect(field.text).toBe('Pouvoir dupliquer');
  });

  it('stop() returns to idle, the text kept, the timer stopped', () => {
    vi.useFakeTimers();
    const { field, changes } = setup();
    field.start('');
    fakeSpeech().say('Pouvoir dupliquer', false);
    field.stop();
    expect(fakeSpeech().listening).toBe(false);
    expect(field.view()).toMatchObject({ state: 'idle', elapsedSeconds: 0, error: null });
    expect(field.text).toBe('Pouvoir dupliquer');
    const after = changes();
    vi.advanceTimersByTime(5_000);
    expect(changes()).toBe(after);
  });

  it('a refused microphone says so and returns to idle; the next dictation clears it', () => {
    const { field } = setup();
    field.start('');
    fakeSpeech().fail('not-allowed');
    expect(field.view()).toMatchObject({ state: 'idle', error: 'Micro refusé : autorise-le dans ton navigateur.' });
    field.start('');
    expect(field.view()).toMatchObject({ state: 'dictating', error: null });
  });

  it('a dictation that heard nothing dictates nothing', () => {
    const { field } = setup();
    field.start('Tapé');
    field.stop();
    expect(field.dictated).toBe(false);
    expect(field.text).toBe('Tapé');
  });

  it('the notice shows during the first dictation of the Appareil only, kept in localStorage', () => {
    const storage = memory();
    const first = setup(storage).field;
    expect(first.view().notice).toBe(false);
    first.start('');
    expect(first.view().notice).toBe(true);
    first.stop();
    expect(first.view().notice).toBe(false);
    expect(storage.items.get(DICTATION_NOTICE_KEY)).toBeDefined();
    const later = setup(storage).field;
    later.start('');
    expect(later.view().notice).toBe(false);
  });

  it('a storage that refuses shows the notice anyway', () => {
    const { field } = setup({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      items: new Map(),
    });
    field.start('');
    expect(field.view().notice).toBe(true);
    expect(() => field.stop()).not.toThrow();
  });

  it('reset() stops it and forgets the text, the error and that it was dictated', () => {
    const { field } = setup();
    field.start('');
    fakeSpeech().say('Pouvoir', true);
    field.reset();
    expect(fakeSpeech().listening).toBe(false);
    expect(field.view()).toMatchObject({ state: 'idle', error: null });
    expect(field.text).toBe('');
    expect(field.dictated).toBe(false);
  });

  it('start() while dictating changes nothing', () => {
    const { field } = setup();
    field.start('');
    field.start('autre');
    expect(fakeSpeech().started).toBe(1);
    expect(field.text).toBe('');
  });
});
