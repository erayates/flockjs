import { describe, expect, it } from 'vitest';

import { createDevtoolsStub } from './index';

describe('createDevtoolsStub', () => {
  it('returns devtools stub identifier', () => {
    expect(createDevtoolsStub()).toBe('@flockjs/devtools-stub');
  });
});
