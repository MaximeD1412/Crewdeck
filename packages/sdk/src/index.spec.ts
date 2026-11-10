import * as sdk from './index.js';

describe('the SDK', () => {
  it('exports its version', () => {
    expect(sdk.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exports what a Skin needs', () => {
    for (const name of ['defineComposant', 'defineSkin', 'emitAction', 't', 'formatRelative', 'formatHour', 'formatDay', 'formatNumber', 'formatPercent', 'formatEuros']) {
      expect(typeof sdk[name as keyof typeof sdk], name).toBe('function');
    }
    expect(sdk.COMPOSANTS.PageIntrouvable.tag).toBe('cd-page-introuvable');
    expect(sdk.BREAKPOINT_PX).toBe(1280);
  });
});
