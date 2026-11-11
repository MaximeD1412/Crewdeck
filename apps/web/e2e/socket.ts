import type { Page, WebSocketRoute } from '@playwright/test';

export interface SocketCut {
  /** Closes the page's socket; the sockets it opens next are held, never reaching the server. */
  cut(): Promise<void>;
  /** Closes the held sockets: the next one reaches the server again. */
  release(): Promise<void>;
}

/**
 * Routes the page's `/api/ws` (call it before the page opens its socket):
 * through to the server until `cut`, then held, answered by nothing, until
 * `release`. Held, the page's socket is open but the server never says
 * `live`: the page stays in Resynchronisation.
 */
export const routeSocket = async (page: Page): Promise<SocketCut> => {
  let held = false;
  // Each socket the page opened, and its server's side when it reaches the server.
  const sockets: { page: WebSocketRoute; server: WebSocketRoute | null }[] = [];
  await page.routeWebSocket('**/api/ws', (ws) => {
    sockets.push({ page: ws, server: held ? null : ws.connectToServer() });
  });
  const closeAll = async () => {
    // A socket the page or the server already closed closes again without effect.
    for (const { page: side, server } of sockets.splice(0)) {
      await side.close({ code: 4000, reason: 'cut' }).catch(() => undefined);
      await server?.close().catch(() => undefined);
    }
  };
  return {
    async cut() {
      held = true;
      await closeAll();
    },
    async release() {
      held = false;
      await closeAll();
    },
  };
};
