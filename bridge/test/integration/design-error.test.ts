// Property values rejected by LS surface as design.error with full context.

import { describe, test } from 'vitest';

describe('design.error integration', () => {
  test.todo('a rejected property value emits design.error');
  test.todo('error payload includes the node id');
  test.todo('error payload includes the failing property path');
  test.todo('error payload includes the LS error message verbatim');
  test.todo('subsequent valid mutations still apply (one error does not poison the session)');
});
