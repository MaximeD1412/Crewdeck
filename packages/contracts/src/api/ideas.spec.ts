import { ideaItemAad, zIdeaText, zListIdeasQuery, zNoteIdeaInput } from './ideas.js';

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString('base64url');
const sealed = (ciphertext: number) => ({ key: b64(60), ciphertext: b64(ciphertext) });

describe('the Idées API', () => {
  it('refuses a text sealed from an empty plaintext (the nonce and the tag alone)', () => {
    expect(zIdeaText.safeParse(sealed(28)).success).toBe(false);
    expect(zIdeaText.safeParse(sealed(29)).success).toBe(true);
    expect(zIdeaText.safeParse({ ...sealed(29), plaintext: 'x' }).success).toBe(false);
  });

  it('reads a note with its id, its sealed text, its Projet or none, and the seq', () => {
    const note = { id: '0193a4f2-7c1e-7a10-8c2c-000000000064', text: sealed(40), projectId: null, notedFrom: 'pc', dictated: false, seq: '12' };
    expect(zNoteIdeaInput.parse(note)).toMatchObject({ projectId: null, seq: 12 });
    expect(zNoteIdeaInput.safeParse({ ...note, notedFrom: 'tablette' }).success).toBe(false);
  });

  it('needs `states`, one or several separated by commas', () => {
    expect(zListIdeasQuery.safeParse({}).success).toBe(false);
    expect(zListIdeasQuery.safeParse({ states: '' }).success).toBe(false);
    expect(zListIdeasQuery.parse({ states: 'merged,rejected' }).states).toEqual(['merged', 'rejected']);
    expect(zListIdeasQuery.safeParse({ states: 'merged,oubliée' }).success).toBe(false);
  });

  it('binds a sealed field to its Idée and its name', () => {
    expect(ideaItemAad('0193a4f2-7c1e-7a10-8c2c-000000000064', 'text')).toBe('0193a4f2-7c1e-7a10-8c2c-000000000064:text');
  });
});
