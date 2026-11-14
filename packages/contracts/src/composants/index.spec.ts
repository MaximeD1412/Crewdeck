import { ARTIFACT_TYPES } from '../process/artifact-types.js';
import { COMPOSANTS, PORT_TYPES } from './index.js';

describe('COMPOSANTS', () => {
  const declarations = Object.entries(COMPOSANTS);

  it('keys every declaration by its name', () => {
    for (const [key, declaration] of declarations) expect(declaration.name).toBe(key);
  });

  it('gives each Composant its own tag', () => {
    const tags = declarations.map(([, declaration]) => declaration.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it.each([
    ['cadre', ['PageHeader', 'ProjectFilter']],
    ['page', ['PageComposants', 'PageConnexion', 'PageDemarrage', 'PageIntrouvable', 'PageRunner']],
    [
      'partie',
      [
        'AgentRow',
        'Capture',
        'Card',
        'CheckRow',
        'CodeBlock',
        'Composer',
        'DecisionRow',
        'Dialog',
        'IdeaRow',
        'KeyValue',
        'ListRow',
        'LoopBack',
        'Message',
        'PermissionRequest',
        'Phase',
        'Port',
        'ProcessCanvas',
        'ProcessTrack',
        'Question',
        'Session',
        'SettingRow',
        'Stat',
        'StepCard',
        'TicketRow',
        'TicketTree',
        'Timeline',
        'ToolCall',
        'ToolChip',
        'UsageMeter',
      ],
    ],
    [
      'signal',
      ['Banner', 'Button', 'Checkbox', 'Chip', 'Empty', 'Icon', 'IconButton', 'Radio', 'Select', 'StatusBadge', 'StatusDot', 'Tabs', 'TextField', 'Toast', 'Toggle'],
    ],
  ])('puts the base Composants of %s in their category', (category, names) => {
    for (const name of names) expect(COMPOSANTS[name as keyof typeof COMPOSANTS].category, name).toBe(category);
  });

  it('gives each Composant the tag of its name in kebab case', () => {
    for (const [name, declaration] of declarations) {
      expect(declaration.tag).toBe(`cd-${name.replace(/(?<!^)[A-Z]/g, (c) => `-${c}`).toLowerCase()}`);
    }
  });

  it.each(['TextField', 'Select', 'Toggle', 'Checkbox', 'Radio'] as const)(
    'declares %s as a form control with no action of the core, saying so in its description',
    (name) => {
      expect(COMPOSANTS[name].actions).toEqual({});
      expect(COMPOSANTS[name].description).toMatch(/input et change.*FormData/);
    },
  );

  it('declares Dialog with its close action and its body and actions Emplacements', () => {
    expect(COMPOSANTS.Dialog).toMatchObject({ tag: 'cd-dialog', category: 'partie', slots: ['default', 'actions'] });
    expect(Object.keys(COMPOSANTS.Dialog.actions)).toEqual(['close']);
    expect(COMPOSANTS.Dialog.actions.close.parse({})).toEqual({});
  });

  it('declares SettingRow with its control in the default Emplacement', () => {
    expect(COMPOSANTS.SettingRow).toMatchObject({ category: 'partie', slots: ['default'] });
    const origin = COMPOSANTS.SettingRow.data.shape.origin;
    expect(['compte', 'projet', null].map((value) => origin.safeParse(value).success)).toEqual([true, true, true]);
    expect(origin.safeParse('autre').success).toBe(false);
  });

  it('names the ports\' types as the Types d\'artefact', () => {
    expect(PORT_TYPES).toEqual(ARTIFACT_TYPES);
  });

  it('gives the Cadre a compact variant, with its example', () => {
    expect(COMPOSANTS.Cadre.data.shape.variant.options).toEqual(['default', 'bare', 'compact']);
    expect(COMPOSANTS.Cadre.examples.map((example) => example.data.variant)).toContain('compact');
  });

  it('lets the canvas emit its editing actions with both ends', () => {
    const { actions } = COMPOSANTS.ProcessCanvas;
    expect(Object.keys(actions).sort()).toEqual(['connect', 'loopBack', 'moveStep', 'select', 'view']);
    const end = { stepId: 'code', portId: 'changement' };
    expect(actions.connect.parse({ from: end, to: { stepId: 'checks', portId: 'changement' } })).toBeTruthy();
    expect(actions.select.parse({ target: null })).toEqual({ target: null });
    expect(actions.view.safeParse({ zoom: 210, pan: { x: 0, y: 0 } }).success).toBe(false);
  });

  it('declares PageIntrouvable as a page with no data', () => {
    expect(COMPOSANTS.PageIntrouvable).toMatchObject({ tag: 'cd-page-introuvable', category: 'page', slots: [] });
    expect(COMPOSANTS.PageIntrouvable.data.parse({})).toEqual({});
  });
});
