function getSocketServerUrl() {
  const configured = (window.BINGEWATCH_SOCKET_URL || "").trim();
  return configured || window.location.origin;
}
