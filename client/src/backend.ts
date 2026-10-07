import "@colyseus/sdk/debug";

export const BACKEND_URL = (window.location.href.indexOf("localhost") === -1)
    ? `${window.location.protocol.replace("http", "ws")}//${window.location.hostname}${(window.location.port && `:${window.location.port}`)}`
    : "ws://localhost:2567"

/**
 * HTTP counterpart of BACKEND_URL (the Colyseus server also exposes
 * custom express routes - see server/src/app.config.ts). We swap the
 * protocol from ws:// to http:// and keep host/port identical.
 */
export const BACKEND_HTTP_URL = (() => {
  const ws = BACKEND_URL;
  if (ws.startsWith("wss://")) return "https://" + ws.slice("wss://".length);
  if (ws.startsWith("ws://")) return "http://" + ws.slice("ws://".length);
  return ws;
})();
