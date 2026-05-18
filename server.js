const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// ════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ════════════════════════════════════════════════════
const wss = new WebSocket.Server({ server });

// State management
const rooms = new Map(); // roomName -> { users: Map<userId, user>, videoState: {...}, connections: Map }
const userSessions = new Map(); // userId -> { ws, roomId, username, hasCamera }

// ════════════════════════════════════════════════════
// MESSAGE PROTOCOL
// ════════════════════════════════════════════════════
// Messages are JSON objects with a 'type' field:
// {
//   type: 'create-room' | 'check-room' | 'join-room' | 'leave-room' | 'play-video' | 'pause-video' | 'seek-video' | 'change-video' | 'chat-message' | 'reaction' | 'webrtc-*' | 'camera-toggle' | 'ping',
//   ... type-specific fields
// }

// ────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────────────────

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++)
    id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateAnonName() {
  const adj = [
    "Lazy",
    "Epic",
    "Ninja",
    "Cosmic",
    "Sneaky",
    "Hyper",
    "Chill",
    "Fuzzy",
    "Bold",
    "Witty",
  ];
  const noun = [
    "Panda",
    "Fox",
    "Tiger",
    "Wolf",
    "Eagle",
    "Shark",
    "Dragon",
    "Sloth",
    "Koala",
    "Lynx",
  ];
  return (
    adj[Math.floor(Math.random() * adj.length)] +
    noun[Math.floor(Math.random() * noun.length)] +
    Math.floor(Math.random() * 90 + 10)
  );
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const data = JSON.stringify(message);
  room.connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function sendToUser(userId, message) {
  const session = userSessions.get(userId);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(message));
  }
}

// ════════════════════════════════════════════════════
// WEBSOCKET CONNECTION HANDLER
// ════════════════════════════════════════════════════
wss.on("connection", (ws) => {
  let userId = null;
  let roomId = null;
  let username = null;
  let hasCamera = false;

  console.log(`[WebSocket] New connection: ${ws._socket.remoteAddress}`);

  // Keep-alive ping (every 30 seconds)
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  // ── Message Handler ──────────────────────────────
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(ws, msg, {
        userId,
        roomId,
        username,
        hasCamera,
        setUserId: (id) => (userId = id),
        setRoomId: (rid) => (roomId = rid),
        setUsername: (name) => (username = name),
        setHasCamera: (val) => (hasCamera = val),
      });
    } catch (error) {
      console.error("[WebSocket] Error parsing message:", error.message);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
        })
      );
    }
  });

  // ── Disconnect Handler ───────────────────────────
  ws.on("close", () => {
    clearInterval(pingInterval);
    console.log(`[WebSocket] Disconnected: ${userId} from ${roomId}`);

    if (roomId && userId) {
      const room = rooms.get(roomId);
      if (room) {
        room.users.delete(userId);
        room.connections.delete(userId);

        const users = Array.from(room.users.values());
        broadcastToRoom(roomId, {
          type: "user-left",
          userId,
          username,
          users,
        });

        // Clean up empty room
        if (room.users.size === 0) {
          rooms.delete(roomId);
          console.log(`[Room] Deleted empty room: ${roomId}`);
        }
      }
    }

    userSessions.delete(userId);
  });

  // ── Error Handler ────────────────────────────────
  ws.on("error", (error) => {
    console.error("[WebSocket] Error:", error.message);
  });

  ws.on("pong", () => {
    // Keep-alive response
  });
});

// ════════════════════════════════════════════════════
// MESSAGE HANDLER
// ════════════════════════════════════════════════════
function handleMessage(ws, msg, context) {
  const { type, ...payload } = msg;

  switch (type) {
    // ── Room Management ──────────────────────────
    case "create-room":
      handleCreateRoom(ws, payload, context);
      break;

    case "check-room":
      handleCheckRoom(ws, payload, context);
      break;

    case "join-room":
      handleJoinRoom(ws, payload, context);
      break;

    case "leave-room":
      handleLeaveRoom(context);
      break;

    // ── Video Control ────────────────────────────
    case "play-video":
      handlePlayVideo(payload, context);
      break;

    case "pause-video":
      handlePauseVideo(payload, context);
      break;

    case "seek-video":
      handleSeekVideo(payload, context);
      break;

    case "change-video":
      handleChangeVideo(payload, context);
      break;

    // ── Chat / Reactions ─────────────────────────
    case "chat-message":
      handleChatMessage(payload, context);
      break;

    case "reaction":
      handleReaction(payload, context);
      break;

    // ── WebRTC Signaling ─────────────────────────
    case "webrtc-offer":
    case "webrtc-answer":
    case "webrtc-ice":
      handleWebRTC(msg, context);
      break;

    // ── Camera Toggle ────────────────────────────
    case "camera-toggle":
      handleCameraToggle(payload, context);
      break;

    // ── Ping (keep-alive) ────────────────────────
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }));
      break;

    default:
      console.log(`[WebSocket] Unknown message type: ${type}`);
  }
}

// ════════════════════════════════════════════════════
// MESSAGE HANDLERS
// ════════════════════════════════════════════════════

function handleCreateRoom(ws, payload, context) {
  let newRoomId;
  do {
    newRoomId = generateRoomId();
  } while (rooms.has(newRoomId));

  rooms.set(newRoomId, {
    id: newRoomId,
    users: new Map(),
    videoUrl: "",
    videoState: { isPlaying: false, currentTime: 0, updatedAt: Date.now() },
    createdAt: Date.now(),
    connections: new Map(),
  });

  ws.send(
    JSON.stringify({
      type: "room-created",
      success: true,
      roomId: newRoomId,
    })
  );

  console.log(`[Room] Created room: ${newRoomId}`);
}

function handleCheckRoom(ws, payload, context) {
  const { roomId } = payload;
  const exists = rooms.has(roomId.toUpperCase().trim());

  ws.send(
    JSON.stringify({
      type: "room-check",
      roomId: roomId.toUpperCase().trim(),
      exists,
    })
  );
}

function handleJoinRoom(ws, payload, context) {
  const { roomId, username } = payload;
  const normalizedRoomId = roomId.toUpperCase().trim();

  if (!rooms.has(normalizedRoomId)) {
    ws.send(
      JSON.stringify({
        type: "join-failed",
        success: false,
        error: "Room not found",
      })
    );
    return;
  }

  const room = rooms.get(normalizedRoomId);
  const newUserId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const newUsername = (username || "").trim() || generateAnonName();
  const userData = {
    id: newUserId,
    username: newUsername,
    hasCamera: false,
    joinedAt: Date.now(),
  };

  context.setUserId(newUserId);
  context.setRoomId(normalizedRoomId);
  context.setUsername(newUsername);
  context.setHasCamera(false);

  room.users.set(newUserId, userData);
  room.connections.set(newUserId, ws);
  userSessions.set(newUserId, {
    ws,
    roomId: normalizedRoomId,
    username: newUsername,
    hasCamera: false,
  });

  const users = Array.from(room.users.values());

  ws.send(
    JSON.stringify({
      type: "joined-room",
      success: true,
      user: userData,
      users,
      videoUrl: room.videoUrl,
      videoState: room.videoState,
    })
  );

  broadcastToRoom(normalizedRoomId, {
    type: "user-joined",
    user: userData,
    users,
  });

  console.log(
    `[Room] ${newUsername} joined ${normalizedRoomId}. Total: ${room.users.size}`
  );
}

function handleLeaveRoom(context) {
  const { roomId, userId, username } = context;
  if (roomId && userId) {
    const room = rooms.get(roomId);
    if (room) {
      room.users.delete(userId);
      room.connections.delete(userId);
      const users = Array.from(room.users.values());

      broadcastToRoom(roomId, {
        type: "user-left",
        userId,
        username,
        users,
      });

      if (room.users.size === 0) {
        rooms.delete(roomId);
      }
    }
  }
}

function handlePlayVideo(payload, context) {
  const { roomId, currentTime } = payload;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  room.videoState = {
    isPlaying: true,
    currentTime,
    updatedAt: Date.now(),
  };

  broadcastToRoom(roomId, {
    type: "play-video",
    currentTime,
    by: context.username,
  });
}

function handlePauseVideo(payload, context) {
  const { roomId, currentTime } = payload;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  room.videoState = {
    isPlaying: false,
    currentTime,
    updatedAt: Date.now(),
  };

  broadcastToRoom(roomId, {
    type: "pause-video",
    currentTime,
    by: context.username,
  });
}

function handleSeekVideo(payload, context) {
  const { roomId, currentTime } = payload;
  if (!roomId || !rooms.has(roomId)) return;

  rooms.get(roomId).videoState.currentTime = currentTime;
  rooms.get(roomId).videoState.updatedAt = Date.now();

  broadcastToRoom(roomId, {
    type: "seek-video",
    currentTime,
  });
}

function handleChangeVideo(payload, context) {
  const { roomId, url } = payload;
  if (!roomId || !rooms.has(roomId)) return;

  const room = rooms.get(roomId);
  room.videoUrl = url;
  room.videoState = {
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
  };

  broadcastToRoom(roomId, {
    type: "video-changed",
    url,
    by: context.username,
  });
}

function handleChatMessage(payload, context) {
  const { roomId, message } = payload;
  if (!roomId || !rooms.has(roomId) || !context.userId) return;

  const msg = {
    id: `${Date.now()}-${context.userId}`,
    userId: context.userId,
    username: context.username,
    message: message.toString().trim().slice(0, 300),
    timestamp: Date.now(),
  };

  broadcastToRoom(roomId, {
    type: "chat-message",
    ...msg,
  });
}

function handleReaction(payload, context) {
  const { roomId, emoji } = payload;
  if (!roomId || !rooms.has(roomId)) return;

  broadcastToRoom(roomId, {
    type: "reaction",
    emoji,
    username: context.username,
  });
}

function handleWebRTC(msg, context) {
  const { type, targetId, ...data } = msg;

  if (!targetId) return;

  sendToUser(targetId, {
    type,
    fromId: context.userId,
    fromUsername: context.username,
    ...data,
  });
}

function handleCameraToggle(payload, context) {
  const { roomId, enabled } = payload;
  if (!roomId || !rooms.has(roomId) || !context.userId) return;

  const room = rooms.get(roomId);
  const user = room.users.get(context.userId);
  if (user) {
    user.hasCamera = enabled;
    context.setHasCamera(enabled);

    const users = Array.from(room.users.values());
    broadcastToRoom(roomId, {
      type: "camera-toggled",
      userId: context.userId,
      username: context.username,
      enabled,
      users,
    });
  }
}

// ════════════════════════════════════════════════════
// EXPRESS ROUTES
// ════════════════════════════════════════════════════

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rooms: rooms.size,
    users: userSessions.size,
    timestamp: Date.now(),
  });
});

// Fallback route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ════════════════════════════════════════════════════
// CLEANUP TASK (every 30 minutes)
// ════════════════════════════════════════════════════
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  for (const [id, room] of rooms.entries()) {
    if (room.users.size === 0 && room.createdAt < cutoff) {
      rooms.delete(id);
      console.log(`[Cleanup] Removed old empty room: ${id}`);
    }
  }
}, 30 * 60 * 1000);

// ════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════

const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`\n🎬  BingeWatch Server (WebSocket) running!`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Network: http://${HOST}:${PORT}`);
  console.log(`    WebSocket: ws://${HOST}:${PORT}\n`);
});
