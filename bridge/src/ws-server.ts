// WebSocket server. Speaks the protocol documented in PROTOCOL.md.
//
// Routes client messages to a handler map (set by daemon.ts). Each
// connected client receives a `hello` on connect and any broadcasts
// (sandbox.down, etc.) thereafter.

import { WebSocketServer, type WebSocket } from 'ws';
import { ClientToServerMsgSchema, type ClientToServerMsg, type ServerToClientMsg } from './protocol.ts';

export interface WsClient {
  send(msg: ServerToClientMsg): void;
  close(reason?: string): void;
  readonly id: number;
}

export type MessageHandler = (
  msg: ClientToServerMsg,
  client: WsClient,
) => void | Promise<void>;

export interface WsServerHandle {
  port: number;
  broadcast(msg: ServerToClientMsg): void;
  clientCount(): number;
  close(): Promise<void>;
}

export interface WsServerOptions {
  port: number;
  onConnect: (client: WsClient) => void | Promise<void>;
  onMessage: MessageHandler;
  onDisconnect?: (client: WsClient) => void;
}

/** Start a WS server (loopback by default; set BRIDGE_BIND_ALL=1 to bind 0.0.0.0). */
export async function startWsServer(opts: WsServerOptions): Promise<WsServerHandle> {
  const host = process.env['BRIDGE_BIND_ALL'] ? '0.0.0.0' : '127.0.0.1';
  const wss = new WebSocketServer({ host, port: opts.port });

  await new Promise<void>((ok, fail) => {
    wss.once('error', fail);
    wss.once('listening', () => {
      wss.off('error', fail);
      ok();
    });
  });

  const clients = new Map<number, { socket: WebSocket; client: WsClient }>();
  let nextId = 1;

  wss.on('connection', (socket) => {
    const id = nextId++;
    const client: WsClient = {
      id,
      send(msg) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      },
      close(reason) {
        socket.close(1000, reason);
      },
    };
    clients.set(id, { socket, client });

    socket.on('message', async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch (err) {
        process.stderr.write(
          `[ws#${id}] malformed JSON, ignoring: ${(err as Error).message}\n`,
        );
        return;
      }

      const result = ClientToServerMsgSchema.safeParse(parsed);
      if (!result.success) {
        process.stderr.write(
          `[ws#${id}] schema-invalid message, ignoring: ${result.error.message}\n`,
        );
        return;
      }

      try {
        await opts.onMessage(result.data, client);
      } catch (err) {
        process.stderr.write(
          `[ws#${id}] handler threw: ${(err as Error).stack ?? (err as Error).message}\n`,
        );
      }
    });

    socket.on('close', () => {
      clients.delete(id);
      if (opts.onDisconnect) {
        try {
          opts.onDisconnect(client);
        } catch (err) {
          process.stderr.write(
            `[ws#${id}] onDisconnect threw: ${(err as Error).message}\n`,
          );
        }
      }
    });

    socket.on('error', (err) => {
      process.stderr.write(`[ws#${id}] socket error: ${err.message}\n`);
    });

    // Fire onConnect; surfaces errors but never tears down the server.
    Promise.resolve(opts.onConnect(client)).catch((err) => {
      process.stderr.write(
        `[ws#${id}] onConnect threw: ${(err as Error).stack ?? (err as Error).message}\n`,
      );
    });
  });

  const addr = wss.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('WS server failed to bind a TCP port');
  }

  return {
    port: addr.port,
    broadcast(msg) {
      for (const { client } of clients.values()) client.send(msg);
    },
    clientCount() {
      return clients.size;
    },
    async close() {
      await new Promise<void>((ok) => wss.close(() => ok()));
    },
  };
}
