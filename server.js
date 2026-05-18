const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// In-memory room storage
const rooms = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────
function normalizeRoomId(value) {
  if (typeof value !== "string") return "";
  return value.toUpperCase().trim();
}

function normalizeTime(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
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

// ─── Socket.io ──────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  let userRoom = null;
  let userData = null;

  // ── Create a new room ──
  socket.on("create-room", (callback) => {
    let roomId;
    do {
      roomId = generateRoomId();
    } while (rooms.has(roomId));

    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      videoUrl: "",
      videoState: { isPlaying: false, currentTime: 0, updatedAt: Date.now() },
      createdAt: Date.now(),
    });

    if (typeof callback === "function") {
      callback({ success: true, roomId });
    }
  });

  // ── Check if room exists ──
  socket.on("check-room", (roomId, callback) => {
    if (typeof callback !== "function") return;
    callback({ exists: rooms.has(normalizeRoomId(roomId)) });
  });

  // ── Join a room ──
  socket.on("join-room", ({ roomId, username } = {}, callback) => {
    if (typeof callback !== "function") return;
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId)) {
      return callback({ success: false, error: "Room not found" });
    }

    const room = rooms.get(roomId);
    userRoom = roomId;
    userData = {
      id: socket.id,
      username: (username || "").trim() || generateAnonName(),
      hasCamera: false,
      joinedAt: Date.now(),
    };

    room.users.set(socket.id, userData);
    socket.join(roomId);

    const users = Array.from(room.users.values());

    callback({
      success: true,
      user: userData,
      users,
      videoUrl: room.videoUrl,
      videoState: room.videoState,
    });

    socket.to(roomId).emit("user-joined", { user: userData, users });
  });

  // ── Video Sync ──
  socket.on("play-video", ({ roomId, currentTime } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const nextTime = normalizeTime(currentTime);
    room.videoState = { isPlaying: true, currentTime: nextTime, updatedAt: Date.now() };
    socket
      .to(roomId)
      .emit("play-video", { currentTime: nextTime, by: userData?.username });
  });

  socket.on("pause-video", ({ roomId, currentTime } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const nextTime = normalizeTime(currentTime);
    room.videoState = { isPlaying: false, currentTime: nextTime, updatedAt: Date.now() };
    socket
      .to(roomId)
      .emit("pause-video", { currentTime: nextTime, by: userData?.username });
  });

  socket.on("seek-video", ({ roomId, currentTime } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId)) return;
    const nextTime = normalizeTime(currentTime);
    rooms.get(roomId).videoState.currentTime = nextTime;
    rooms.get(roomId).videoState.updatedAt = Date.now();
    socket.to(roomId).emit("seek-video", { currentTime: nextTime });
  });

  socket.on("change-video", ({ roomId, url } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId)) return;
    const nextUrl = typeof url === "string" ? url.trim().slice(0, 2048) : "";
    if (!nextUrl) return;
    const room = rooms.get(roomId);
    room.videoUrl = nextUrl;
    room.videoState = {
      isPlaying: false,
      currentTime: 0,
      updatedAt: Date.now(),
    };
    io.to(roomId).emit("video-changed", { url: nextUrl, by: userData?.username });
  });

  // ── Chat ──
  socket.on("chat-message", ({ roomId, message } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId) || !userData) return;
    const cleanMessage =
      typeof message === "string" ? message.trim().slice(0, 300) : "";
    if (!cleanMessage) return;
    const msg = {
      id: `${Date.now()}-${socket.id}`,
      userId: socket.id,
      username: userData.username,
      message: cleanMessage,
      timestamp: Date.now(),
    };
    io.to(roomId).emit("chat-message", msg);
  });

  // ── Emoji Reactions ──
  socket.on("reaction", ({ roomId, emoji } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId) || !userData) return;
    if (typeof emoji !== "string" || emoji.length > 8) return;
    socket.to(roomId).emit("reaction", { emoji, username: userData.username });
  });

  // ── WebRTC Signaling ──
  socket.on("webrtc-offer", ({ targetId, offer }) => {
    io.to(targetId).emit("webrtc-offer", {
      fromId: socket.id,
      fromUsername: userData?.username,
      offer,
    });
  });

  socket.on("webrtc-answer", ({ targetId, answer }) => {
    io.to(targetId).emit("webrtc-answer", { fromId: socket.id, answer });
  });

  socket.on("webrtc-ice", ({ targetId, candidate }) => {
    io.to(targetId).emit("webrtc-ice", { fromId: socket.id, candidate });
  });

  socket.on("camera-toggle", ({ roomId, enabled } = {}) => {
    roomId = normalizeRoomId(roomId);
    if (!rooms.has(roomId) || !userData) return;
    userData.hasCamera = Boolean(enabled);
    const users = Array.from(rooms.get(roomId).users.values());
    io.to(roomId).emit("camera-toggled", {
      userId: socket.id,
      username: userData.username,
      enabled: Boolean(enabled),
      users,
    });
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    if (!userRoom || !rooms.has(userRoom)) return;
    const room = rooms.get(userRoom);
    room.users.delete(socket.id);

    const users = Array.from(room.users.values());
    io.to(userRoom).emit("user-left", {
      userId: socket.id,
      username: userData?.username,
      users,
    });

    // Clean up empty rooms after 10 minutes
    if (room.users.size === 0) {
      setTimeout(
        () => {
          if (rooms.has(userRoom) && rooms.get(userRoom).users.size === 0) {
            rooms.delete(userRoom);
            console.log(`🗑️  Room ${userRoom} removed (empty)`);
          }
        },
        10 * 60 * 1000,
      );
    }
  });
});

// ─── Cleanup old empty rooms periodically ───────────────────────────────────
setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
    for (const [id, room] of rooms.entries()) {
      if (room.users.size === 0 && room.createdAt < cutoff) {
        rooms.delete(id);
      }
    }
  },
  30 * 60 * 1000,
);

// ─── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0"; // Required for Railway / Docker — listens on all interfaces

server.listen(PORT, HOST, () => {
  console.log(`\n🎬  BingeWatch is running!`);
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Network: http://${HOST}:${PORT}\n`);
});
