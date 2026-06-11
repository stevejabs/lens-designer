// portToPid.test.ts — bridge-side delegation to the addon's portToPid.
// Replaces the legacy pidListeningOnPort.test.ts (lsof-shape) deleted
// at Phase 1 Step 6.
//
// Real test: bind a TCP listener in the test process, call
// pidListeningOnPort, expect self-pid. Free port → null.

import { describe, test, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { pidListeningOnPort } from '../src/capture.ts';

describe.skipIf(process.platform !== 'darwin')(
  'pidListeningOnPort (mac-only: libproc port→pid)',
  () => {
    test('returns null for a free port', () => {
      // Pick an unlikely port; nothing should be there.
      expect(pidListeningOnPort(63421)).toBeNull();
    });

    test('returns self pid for a port the test process binds', async () => {
      const { port, close } = await listenEphemeral();
      try {
        const pid = pidListeningOnPort(port);
        expect(pid).toBe(process.pid);
      } finally {
        await close();
      }
    });

    test('returns null after the listener is torn down', async () => {
      const { port, close } = await listenEphemeral();
      await close();
      // Tiny delay so the kernel has reclaimed the port from any
      // tcp_tw buffer. macOS reuses ephemeral ports fast; in practice
      // this should be null immediately.
      await new Promise((r) => setTimeout(r, 20));
      expect(pidListeningOnPort(port)).toBeNull();
    });
  },
);

async function listenEphemeral(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) {
    server.close();
    throw new Error('failed to bind ephemeral port');
  }
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
