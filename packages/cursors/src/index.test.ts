import { describe, expect, it } from 'vitest';

import { createCursorsStub } from './index';

describe('createCursorsStub', () => {
  it('returns cursors stub identifier', () => {
    expect(createCursorsStub()).toBe('@flockjs/cursors-stub');
  });
});
