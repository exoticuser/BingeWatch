/* ════════════════════════════════════════════════════
   BingeWatch — Landing Page (WebSocket)
   ════════════════════════════════════════════════════ */

// ════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// ════════════════════════════════════════════════════

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 5000;
    this.reconnectAttempts = 0;
    this.messageHandlers = {};
    this.pendingRequests = new Map();
    this.requestId = 0;
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}`;

    console.log(`[WebSocket] Connecting to ${url}`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      console.log("[WebSocket] Connected");
      this.emit("connect");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (error) {
        console.error("[WebSocket] Parse error:", error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
      this.isConnected = false;
      this.emit("error", error);
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      console.log("[WebSocket] Disconnected");
      this.emit("disconnect");
      this.attemptReconnect();
    };
  }

  handleMessage(msg) {
    const { type } = msg;
    
    // Handle typed events
    if (this.messageHandlers[type]) {
      this.messageHandlers[type](msg);
    }
  }

  send(msg) {
    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  emit(type, data = {}) {
    const msg = { type, ...data };
    this.send(msg);
  }

  on(type, handler) {
    this.messageHandlers[type] = handler;
  }

  off(type) {
    delete this.messageHandlers[type];
  }

  once(type, handler) {
    const wrappedHandler = (msg) => {
      handler(msg);
      this.off(type);
    };
    this.on(type, wrappedHandler);
  }

  attemptReconnect() {
    if (this.reconnectAttempts < 50) {
      this.reconnectAttempts++;
      const delay = Math.min(
        this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
        this.maxReconnectDelay
      );
      console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms...`);
      setTimeout(() => this.connect(), delay);
    }
  }
}

const socket = new WebSocketClient();
socket.connect();

// ────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ────────────────────────────────────────────────────

function toast(msg, type = "info", dur = 3000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = "toast"), dur);
}

function setLoading(btn, loading, originalHTML) {
  btn.disabled = loading;
  if (loading) {
    btn.innerHTML = '<span style="opacity:.7">Please wait…</span>';
  } else {
    btn.innerHTML = originalHTML;
  }
}

function goToRoom(roomId, username) {
  const params = new URLSearchParams();
  params.set("room", roomId);
  if (username) params.set("name", username);
  window.location.href = `/room.html?${params.toString()}`;
}

// ════════════════════════════════════════════════════
// PAGE INITIALIZATION
// ════════════════════════════════════════════════════

// Check for invite link in URL
const urlParams = new URLSearchParams(window.location.search);
const inviteRoom = urlParams.get("room");

if (inviteRoom) {
  const code = inviteRoom.toUpperCase().trim();
  document.getElementById("join-code").value = code;
  document.getElementById("join-name").focus();

  const banner = document.getElementById("invite-banner");
  const roomDisp = document.getElementById("invite-room-display");
  roomDisp.textContent = code;
  banner.style.display = "flex";

  // Scroll to join card
  document
    .querySelector(".card-join")
    .scrollIntoView({ behavior: "smooth", block: "center" });
}

// Auto-uppercase & sanitize room code input
document.getElementById("join-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

// ════════════════════════════════════════════════════
// CREATE ROOM
// ════════════════════════════════════════════════════

const createBtn = document.getElementById("create-btn");
const createBtnHTML = createBtn.innerHTML;

createBtn.addEventListener("click", handleCreate);
document.getElementById("create-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleCreate();
});

function handleCreate() {
  const username = document.getElementById("create-name").value.trim();
  setLoading(createBtn, true, createBtnHTML);

  socket.once("room-created", (msg) => {
    if (msg.success) {
      goToRoom(msg.roomId, username);
    } else {
      toast("Could not create room. Please try again.", "error");
      setLoading(createBtn, false, createBtnHTML);
    }
  });

  socket.emit("create-room");
}

// ════════════════════════════════════════════════════
// JOIN ROOM
// ════════════════════════════════════════════════════

const joinBtn = document.getElementById("join-btn");
const joinBtnHTML = joinBtn.innerHTML;

joinBtn.addEventListener("click", handleJoin);
document.getElementById("join-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleJoin();
});
document.getElementById("join-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleJoin();
});

function handleJoin() {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  const username = document.getElementById("join-name").value.trim();

  if (!code) {
    toast("Please enter a room code.", "error");
    document.getElementById("join-code").focus();
    return;
  }
  if (code.length < 4) {
    toast("Room codes are at least 4 characters.", "error");
    document.getElementById("join-code").focus();
    return;
  }

  setLoading(joinBtn, true, joinBtnHTML);

  socket.once("room-check", (msg) => {
    if (msg.exists) {
      goToRoom(code, username);
    } else {
      toast(`Room "${code}" not found. Check the code and try again.`, "error");
      setLoading(joinBtn, false, joinBtnHTML);
      document.getElementById("join-code").focus();
    }
  });

  socket.emit("check-room", { roomId: code });
}

// ════════════════════════════════════════════════════
// CONNECTION STATUS
// ════════════════════════════════════════════════════

socket.on("disconnect", () =>
  toast("Connection lost — reconnecting…", "error", 5000)
);
socket.on("connect", () => {
  /* connection restored */
});

// Update connection status indicator
setInterval(() => {
  const statusEl = document.getElementById("connection-status");
  if (statusEl) {
    if (socket.isConnected) {
      statusEl.textContent = "Connected";
      statusEl.className = "connected";
    } else {
      statusEl.textContent = "Connecting...";
      statusEl.className = "connecting";
    }
  }
}, 1000);
