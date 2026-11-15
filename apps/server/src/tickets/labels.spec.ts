import { branchPrefixOf, priorityOf, productLabels, sizeOf, visualReviewOf } from './labels.js';

describe('priorityOf', () => {
  it.each([
    [['P0'], 'P0'],
    [['P1'], 'P1'],
    [['priority:P2'], 'P2'],
    [['bug', 'priority:P0'], 'P0'],
  ] as const)('reads %j as %s', (labels, priority) => {
    expect(priorityOf(labels)).toBe(priority);
  });

  it('is null without a priority label', () => {
    expect(priorityOf([])).toBeNull();
    expect(priorityOf(['P3', 'priority:high', 'size:S'])).toBeNull();
  });
});

describe('sizeOf', () => {
  it.each([
    [['XS'], 'XS'],
    [['M'], 'M'],
    [['size:S'], 'S'],
    [['size:XL', 'P1'], 'XL'],
    [['size:L'], 'L'],
  ] as const)('reads %j as %s', (labels, size) => {
    expect(sizeOf(labels)).toBe(size);
  });

  it('is null without a size label', () => {
    expect(sizeOf([])).toBeNull();
    expect(sizeOf(['XXL', 'size:huge', 'P1'])).toBeNull();
  });
});

describe('productLabels', () => {
  it('keeps the priority, the size, ready-for-agent and needs-human, nothing else', () => {
    expect(productLabels(['priority:P1', 'size:S', 'ready-for-agent', 'needs-human', 'type:fix', 'revue-visuelle', 'secret plan'])).toEqual([
      'priority:P1',
      'size:S',
      'ready-for-agent',
      'needs-human',
    ]);
    expect(productLabels([])).toEqual([]);
  });
});

describe('branchPrefixOf', () => {
  it('is fix for type:fix, chore for type:chore, feat for any other type or none', () => {
    expect(branchPrefixOf(['type:fix'])).toBe('fix');
    expect(branchPrefixOf(['type:chore', 'P1'])).toBe('chore');
    expect(branchPrefixOf(['type:feat'])).toBe('feat');
    expect(branchPrefixOf(['type:docs'])).toBe('feat');
    expect(branchPrefixOf([])).toBe('feat');
  });
});

describe('visualReviewOf', () => {
  it('is true with the label revue-visuelle only', () => {
    expect(visualReviewOf(['revue-visuelle'])).toBe(true);
    expect(visualReviewOf(['visual-review'])).toBe(false);
    expect(visualReviewOf([])).toBe(false);
  });
});
