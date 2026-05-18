/* ════════════════════════════════════════════════════
   BingeWatch — Room
   Features: Video sync (YouTube + HTML5), Chat,
             WebRTC Facecam, Reactions, Anonymous
   ════════════════════════════════════════════════════ */

"use strict";

// ── URL params ───────────────────────────────────────
const urlP = new URLSearchParams(window.location.search);
const ROOM_ID = (urlP.get("room") || "").toUpperCase().trim();
const NAME_P = (urlP.get("name") || "").trim();

if (!ROOM_ID) {
  window.location.replace("/");
}

// ── Socket ───────────────────────────────────────────
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  transports: ["websocket", "polling"],
});

// ── State ────────────────────────────────────────────
let me = null; // { id, username, hasCamera }
let users = []; // current room users array
let videoType = null; // 'youtube' | 'html5' | null
let ytPlayer = null; // YouTube IFrame player instance
let ytReady = false; // YouTube API loaded?
let ytPending = null; // fn to call when API ready
let isCam = false; // local camera on?
let localStream = null;
const peers = new Map(); // peerId -> RTCPeerConnection
const iceQueue = new Map(); // peerId -> [RTCIceCandidate] (buffered before remoteDesc)
let isConnected = false; // Socket.io connection status

// Guard flag: set true before programmatic video changes to prevent echo
let remoteCtrl = false;

// ── DOM refs ─────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const overlay = $("overlay");
const overlayMsg = $("overlay-msg");
const roomDisp = $("room-id-display");
const viewerCnt = $("viewer-count");
const usersList = $("users-list");
const userBadge = $("user-count-badge");
const urlInput = $("url-input");
const loadBtn = $("load-btn");
const videoWrap = $("video-wrap");
const ytWrap = $("yt-wrap");
const h5Wrap = $("h5-wrap");
const h5Video = $("h5-video");
const emptyState = $("empty-state");
const ctrlsBar = $("controls-bar");
const ppBtn = $("pp-btn");
const iconPlay = $("icon-play");
const iconPause = $("icon-pause");
const timeCur = $("time-cur");
const timeDur = $("time-dur");
const seekBar = $("seek-bar");
const seekFill = $("seek-fill");
const muteBtn = $("mute-btn");
const volSlider = $("vol-slider");
const fsBtn = $("fs-btn");
const camGrid = $("cam-grid");
const noCams = $("no-cams");
const camBtn = $("cam-btn");
const camBtnText = $("cam-btn-text");
const chatMsgs = $("chat-msgs");
const chatInput = $("chat-input");
const sendBtn = $("send-btn");
const reactionLayer = $("reaction-layer");
const copyBtn = $("copy-btn");
const leaveBtn = $("leave-btn");
const sidebarToggle = $("sidebar-toggle");
const sidebarInner = $("sidebar-inner");

// ════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════
function toast(msg, type = "info", dur = 3200) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = "toast"), dur);
}

// ════════════════════════════════════════════════════
// OVERLAY
// ════════════════════════════════════════════════════
function hideOverlay() {
  overlay.classList.add("fade-out");
  setTimeout(() => overlay.remove(), 600);
}

// ════════════════════════════════════════════════════
// YOUTUBE API
// ════════════════════════════════════════════════════
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
  if (ytPending) {
    ytPending();
    ytPending = null;
  }
};

function ytExtractId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

function loadYouTube(url) {
  const vid = ytExtractId(url);
  if (!vid) {
    toast("Could not extract YouTube video ID.", "error");
    return;
  }

  const doLoad = () => {
    ytWrap.style.display = "block";
    h5Wrap.style.display = "none";
    emptyState.style.display = "none";
    ctrlsBar.style.display = "none";
    videoType = "youtube";

    if (ytPlayer) {
      ytPlayer.loadVideoById(vid);
    } else {
      ytPlayer = new YT.Player("yt-player", {
        videoId: vid,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: onYTReady,
          onStateChange: onYTStateChange,
        },
      });
    }
  };

  if (ytReady) doLoad();
  else ytPending = doLoad;
}

function onYTReady() {
  toast("🎬 YouTube video loaded!", "success");
}

let lastYTState = -1;
function onYTStateChange(ev) {
  if (remoteCtrl) return;
  const s = ev.data;
  const t = ytPlayer.getCurrentTime();

  if (s === YT.PlayerState.PLAYING && lastYTState !== YT.PlayerState.PLAYING) {
    socket.emit("play-video", { roomId: ROOM_ID, currentTime: t });
  } else if (
    s === YT.PlayerState.PAUSED &&
    lastYTState !== YT.PlayerState.PAUSED
  ) {
    socket.emit("pause-video", { roomId: ROOM_ID, currentTime: t });
  }
  lastYTState = s;
}

// ════════════════════════════════════════════════════
// HTML5 VIDEO
// ════════════════════════════════════════════════════
function loadHTML5(url) {
  ytWrap.style.display = "none";
  emptyState.style.display = "none";
  h5Wrap.style.display = "block";
  ctrlsBar.style.display = "flex";
  videoType = "html5";

  h5Video.src = url;
  h5Video.load();
  toast("🎬 Video loaded!", "success");
}

// Play / Pause events
h5Video.addEventListener("play", () => {
  if (remoteCtrl) return;
  setPlayIcon(true);
  socket.emit("play-video", {
    roomId: ROOM_ID,
    currentTime: h5Video.currentTime,
  });
});
h5Video.addEventListener("pause", () => {
  if (remoteCtrl) return;
  setPlayIcon(false);
  socket.emit("pause-video", {
    roomId: ROOM_ID,
    currentTime: h5Video.currentTime,
  });
});
h5Video.addEventListener("ended", () => setPlayIcon(false));

// Seek (debounced to avoid flooding)
let seekTs = 0;
h5Video.addEventListener("seeked", () => {
  if (remoteCtrl) return;
  const now = Date.now();
  if (now - seekTs < 350) return;
  seekTs = now;
  socket.emit("seek-video", {
    roomId: ROOM_ID,
    currentTime: h5Video.currentTime,
  });
});

// Progress bar update
h5Video.addEventListener("timeupdate", () => {
  if (!h5Video.duration) return;
  const pct = (h5Video.currentTime / h5Video.duration) * 100;
  seekFill.style.width = pct + "%";
  timeCur.textContent = fmtTime(h5Video.currentTime);
});
h5Video.addEventListener("loadedmetadata", () => {
  timeDur.textContent = fmtTime(h5Video.duration);
});

// Play/Pause button
ppBtn.addEventListener("click", () => {
  if (!h5Video.src) return;
  h5Video.paused ? h5Video.play() : h5Video.pause();
});

// Seek bar click
seekBar.addEventListener("click", (e) => {
  if (!h5Video.duration) return;
  const rect = seekBar.getBoundingClientRect();
  h5Video.currentTime =
    ((e.clientX - rect.left) / rect.width) * h5Video.duration;
});

// Volume
volSlider.addEventListener("input", () => {
  h5Video.volume = parseFloat(volSlider.value);
  muteBtn.textContent =
    h5Video.volume === 0 ? "🔇" : h5Video.volume < 0.5 ? "🔉" : "🔊";
});
muteBtn.addEventListener("click", () => {
  h5Video.muted = !h5Video.muted;
  muteBtn.textContent = h5Video.muted ? "🔇" : "🔊";
  volSlider.value = h5Video.muted ? 0 : h5Video.volume;
});

// Fullscreen
fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else videoWrap.requestFullscreen();
});

// Helper: set play/pause icon state
function setPlayIcon(playing) {
  iconPlay.style.display = playing ? "none" : "block";
  iconPause.style.display = playing ? "block" : "none";
}

// Helper: format seconds to M:SS
function fmtTime(s) {
  if (!s || isNaN(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════
// VIDEO LOADER (detect type and load)
// ════════════════════════════════════════════════════
function detectType(url) {
  if (!url) return null;
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) return "youtube";
  if (/\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(url)) return "html5";
  return "html5"; // try as direct for other URLs
}

function loadVideo(url, emit = true) {
  if (!url) return;
  urlInput.value = url;
  const type = detectType(url);
  if (type === "youtube") loadYouTube(url);
  else loadHTML5(url);
  if (emit) socket.emit("change-video", { roomId: ROOM_ID, url });
}

loadBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) {
    toast("Paste a video URL first.", "error");
    return;
  }
  loadVideo(url, true);
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadBtn.click();
});

// ════════════════════════════════════════════════════
// REMOTE CONTROL HELPERS
// ════════════════════════════════════════════════════
function remotePlay(t) {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) {
    ytPlayer.seekTo(t, true);
    ytPlayer.playVideo();
  } else if (videoType === "html5") {
    h5Video.currentTime = t;
    h5Video.play().catch(() => {});
    setPlayIcon(true);
  }
  setTimeout(() => {
    remoteCtrl = false;
  }, 500);
}

function remotePause(t) {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) {
    ytPlayer.seekTo(t, true);
    ytPlayer.pauseVideo();
  } else if (videoType === "html5") {
    h5Video.currentTime = t;
    h5Video.pause();
    setPlayIcon(false);
  }
  setTimeout(() => {
    remoteCtrl = false;
  }, 500);
}

function remoteSeek(t) {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) ytPlayer.seekTo(t, true);
  else if (videoType === "html5") h5Video.currentTime = t;
  setTimeout(() => {
    remoteCtrl = false;
  }, 300);
}

// ════════════════════════════════════════════════════
// JOIN ROOM
// ════════════════════════════════════════════════════
roomDisp.textContent = ROOM_ID;
overlayMsg.textContent = `Joining room ${ROOM_ID}…`;

socket.emit("join-room", { roomId: ROOM_ID, username: NAME_P }, (res) => {
  if (!res.success) {
    overlayMsg.textContent = `Room "${ROOM_ID}" not found. Redirecting…`;
    setTimeout(() => window.location.replace("/"), 2000);
    return;
  }

  me = res.user;
  users = res.users;

  document.title = `${ROOM_ID} — BingeWatch`;
  hideOverlay();
  updateUsersList(users);
  sysMsg(`You joined as ${me.username}`);

  // Load existing video if room had one
  if (res.videoUrl) {
    loadVideo(res.videoUrl, false);
    const vs = res.videoState;
    if (vs) {
      const elapsed = (Date.now() - vs.updatedAt) / 1000;
      const syncT = vs.currentTime + (vs.isPlaying ? elapsed : 0);
      // Give the player time to initialise before seeking
      setTimeout(() => {
        remoteSeek(Math.max(0, syncT));
        if (vs.isPlaying) {
          setTimeout(() => remotePlay(Math.max(0, syncT)), 300);
        }
      }, 1500);
    }
  }
});

// ════════════════════════════════════════════════════
// SOCKET — ROOM EVENTS
// ════════════════════════════════════════════════════
socket.on("user-joined", ({ user, users: u }) => {
  users = u;
  updateUsersList(users);
  sysMsg(`${user.username} joined 🎉`);
  // Initiate WebRTC offer if our camera is on
  if (isCam && localStream) createPeer(user.id, true);
});

socket.on("user-left", ({ userId, username, users: u }) => {
  users = u;
  updateUsersList(users);
  sysMsg(`${username} left`);
  closePeer(userId);
  removeCamTile(userId);
});

// ── Video sync ───────────────────────────────────────
socket.on("play-video", ({ currentTime, by }) => {
  remotePlay(currentTime);
  if (by && by !== me?.username) sysMsg(`${by} played ▶`);
});
socket.on("pause-video", ({ currentTime, by }) => {
  remotePause(currentTime);
  if (by && by !== me?.username) sysMsg(`${by} paused ⏸`);
});
socket.on("seek-video", ({ currentTime }) => {
  remoteSeek(currentTime);
});
socket.on("video-changed", ({ url, by }) => {
  if (by && by !== me?.username) sysMsg(`${by} loaded a new video`);
  loadVideo(url, false);
});

// ── Camera changes ───────────────────────────────────
socket.on("camera-toggled", ({ userId, username, enabled, users: u }) => {
  users = u;
  updateUsersList(users);
  if (userId !== socket.id) {
    if (!enabled) {
      closePeer(userId);
      removeCamTile(userId);
    }
    // If they turned camera ON, and we have ours on too, they'll send us an offer
  }
});

// ════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════
socket.on("chat-message", (msg) => addChatMsg(msg));

function sendMessage() {
  const txt = chatInput.value.trim();
  if (!txt) return;
  socket.emit("chat-message", { roomId: ROOM_ID, message: txt });
  chatInput.value = "";
}
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function addChatMsg(msg) {
  const isMe = me && msg.userId === me.id;
  const time = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.innerHTML = `<div class="msg-meta">
       <span class="msg-user${isMe ? " is-me" : ""}">${esc(msg.username)}</span>
       <span class="msg-time">${time}</span>
     </div>
     <div class="msg-text">${esc(msg.message)}</div>`;
  chatMsgs.appendChild(div);
  scrollChat();
}

function sysMsg(text) {
  const div = document.createElement("div");
  div.className = "sys-msg";
  div.textContent = text;
  chatMsgs.appendChild(div);
  scrollChat();
}

function scrollChat() {
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ════════════════════════════════════════════════════
// REACTIONS
// ════════════════════════════════════════════════════
socket.on("reaction", ({ emoji }) => spawnEmoji(emoji));

document.querySelectorAll(".react-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const emoji = btn.dataset.emoji;
    spawnEmoji(emoji); // show locally
    socket.emit("reaction", { roomId: ROOM_ID, emoji }); // broadcast
  });
});

function spawnEmoji(emoji) {
  const el = document.createElement("div");
  el.className = "float-emoji";
  el.textContent = emoji;
  el.style.left = 10 + Math.random() * 75 + "%";
  reactionLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// ════════════════════════════════════════════════════
// USER LIST
// ════════════════════════════════════════════════════
const AV_COLORS = [
  "#e84060",
  "#7c3aed",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

function updateUsersList(list) {
  viewerCnt.textContent = list.length;
  userBadge.textContent = list.length;
  usersList.innerHTML = "";
  list.forEach((u) => {
    const isMe = me && u.id === me.id;
    const col = avatarColor(u.username);
    const li = document.createElement("li");
    li.className = "user-item";
    li.innerHTML = `<div class="user-av" style="background:${col}22;color:${col}">${u.username[0].toUpperCase()}</div>
       <span class="user-name">${esc(u.username)}</span>
       ${isMe ? '<span class="user-you-tag">you</span>' : ""}
       ${u.hasCamera ? '<span class="user-cam-icon">📹</span>' : ""}`;
    usersList.appendChild(li);
  });
}

// ════════════════════════════════════════════════════
// WEBRTC — FACECAM
// ════════════════════════════════════════════════════
const ICE_CONF = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

// Camera toggle button
camBtn.addEventListener("click", toggleCamera);

async function toggleCamera() {
  if (isCam) {
    // Turn OFF
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    isCam = false;
    camBtn.classList.remove("active");
    camBtnText.textContent = "Turn On";
    removeCamTile("local");
    peers.forEach((_, id) => closePeer(id));
    socket.emit("camera-toggle", { roomId: ROOM_ID, enabled: false });
    refreshNoCams();
  } else {
    // Turn ON
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      isCam = true;
      camBtn.classList.add("active");
      camBtnText.textContent = "Turn Off";
      addCamTile("local", localStream, me?.username || "You", true);
      socket.emit("camera-toggle", { roomId: ROOM_ID, enabled: true });
      // Offer to everyone already in room
      users.forEach((u) => {
        if (u.id !== socket.id) createPeer(u.id, true);
      });
    } catch (err) {
      toast("Camera error: " + err.message, "error");
    }
  }
}

// ── WebRTC signaling handlers ────────────────────────
socket.on("webrtc-offer", async ({ fromId, fromUsername, offer }) => {
  const pc = createPeer(fromId, false);
  await setRemoteFlush(pc, fromId, offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("webrtc-answer", { targetId: fromId, answer });
});

socket.on("webrtc-answer", async ({ fromId, answer }) => {
  const pc = peers.get(fromId);
  if (!pc) return;
  await setRemoteFlush(pc, fromId, answer);
});

socket.on("webrtc-ice", ({ fromId, candidate }) => {
  const pc = peers.get(fromId);
  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  } else {
    // buffer it
    if (!iceQueue.has(fromId)) iceQueue.set(fromId, []);
    iceQueue.get(fromId).push(candidate);
  }
});

async function setRemoteFlush(pc, peerId, sdp) {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  // flush queued ICE
  const queued = iceQueue.get(peerId) || [];
  iceQueue.delete(peerId);
  for (const c of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  }
}

// ── Create RTCPeerConnection ────────────────────────
function createPeer(peerId, isInitiator) {
  if (peers.has(peerId)) {
    peers.get(peerId).close();
    peers.delete(peerId);
  }

  const pc = new RTCPeerConnection(ICE_CONF);
  peers.set(peerId, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  // Receive remote stream
  pc.ontrack = (ev) => {
    const stream = ev.streams[0];
    const user = users.find((u) => u.id === peerId);
    addCamTile(peerId, stream, user?.username || "Viewer", false);
  };

  // ICE
  pc.onicecandidate = (ev) => {
    if (ev.candidate)
      socket.emit("webrtc-ice", { targetId: peerId, candidate: ev.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      closePeer(peerId);
      removeCamTile(peerId);
    }
  };

  // Initiator creates offer
  if (isInitiator) {
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() =>
        socket.emit("webrtc-offer", {
          targetId: peerId,
          offer: pc.localDescription,
        }),
      )
      .catch(console.error);
  }

  return pc;
}

function closePeer(id) {
  const pc = peers.get(id);
  if (pc) {
    pc.close();
    peers.delete(id);
  }
}

// ── Camera tile management ──────────────────────────
function addCamTile(id, stream, label, isLocal) {
  removeCamTile(id); // avoid duplicates
  const tile = document.createElement("div");
  tile.id = `cam-${id}`;
  tile.className = "cam-tile" + (isLocal ? " is-local" : "");

  const vid = document.createElement("video");
  vid.autoplay = true;
  vid.playsinline = true;
  vid.muted = isLocal; // mute self to prevent echo
  vid.srcObject = stream;

  const lbl = document.createElement("div");
  lbl.className = "cam-label";
  lbl.textContent = isLocal ? label + " (you)" : label;

  tile.appendChild(vid);
  tile.appendChild(lbl);
  camGrid.appendChild(tile);
  refreshNoCams();
}

function removeCamTile(id) {
  const el = document.getElementById(`cam-${id}`);
  if (el) el.remove();
  refreshNoCams();
}

function refreshNoCams() {
  const tiles = camGrid.querySelectorAll(".cam-tile");
  noCams.style.display = tiles.length === 0 ? "flex" : "none";
}

// ════════════════════════════════════════════════════
// COPY INVITE LINK
// ════════════════════════════════════════════════════
copyBtn.addEventListener("click", () => {
  const link = `${location.origin}/?room=${ROOM_ID}`;
  navigator.clipboard
    .writeText(link)
    .then(() =>
      toast("Invite link copied! 🎉 Share it with friends.", "success"),
    )
    .catch(() => {
      // Fallback for browsers that block clipboard
      const inp = document.createElement("input");
      inp.value = link;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand("copy");
      inp.remove();
      toast("Invite link copied!", "success");
    });
});

// ════════════════════════════════════════════════════
// LEAVE
// ════════════════════════════════════════════════════
leaveBtn.addEventListener("click", leaveRoom);
window.addEventListener("beforeunload", cleanupMedia);

function cleanupMedia() {
  localStream?.getTracks().forEach((t) => t.stop());
  peers.forEach((_, id) => closePeer(id));
}

function leaveRoom() {
  cleanupMedia();
  window.location.replace("/");
}

// ════════════════════════════════════════════════════
// MOBILE SIDEBAR TOGGLE
// ════════════════════════════════════════════════════
sidebarToggle.addEventListener("click", () => {
  sidebarInner.classList.toggle("collapsed");
});

// ════════════════════════════════════════════════════
// SOCKET — CONNECTION STATE
// ════════════════════════════════════════════════════
socket.on("connect", () => {
  isConnected = true;
  console.log("[v0] Socket connected:", socket.id);
});

socket.on("disconnect", (reason) => {
  isConnected = false;
  console.log("[v0] Socket disconnected:", reason);
  toast("Connection lost — reconnecting…", "error", 10000);
});

socket.on("reconnect", () => {
  isConnected = true;
  toast("Reconnected! ✅", "success");
  console.log("[v0] Socket reconnected");
});

socket.on("reconnect_attempt", () => {
  console.log("[v0] Attempting to reconnect...");
});

socket.on("reconnect_error", (error) => {
  console.log("[v0] Reconnection error:", error.message);
});

socket.on("connect_error", (error) => {
  console.log("[v0] Connection error:", error.message);
});
