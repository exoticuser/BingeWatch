/**
 * Resolves the Socket.io server URL from deployment config, with same-origin fallback.
 * @returns {string} Socket server URL used by the client connection.
 */
function getSocketServerUrl() {
  const configured = (window.BINGEWATCH_SOCKET_URL || "").trim();
  return configured || window.location.origin;
}
