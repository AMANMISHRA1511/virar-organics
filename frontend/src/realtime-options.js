// Netlify's static external-proxy path uses HTTP requests. Do not attempt a
// WebSocket upgrade there; keep local and ordinary server builds unchanged.
export function socketTransportOptions(deployTarget) {
  if (deployTarget === "netlify") {
    return { transports: ["polling"], upgrade: false };
  }
  return { transports: ["websocket", "polling"] };
}
