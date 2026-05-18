/* ════════════════════════════════════════════════════
   BingeWatch — Room (WebSocket)
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
let isConnected = false; // WebSocket connection status

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

h5Video.addEventListener("seeked", () => {
  if (remoteCtrl) return;
  socket.emit("seek-video", {
    roomId: ROOM_ID,
    currentTime: h5Video.currentTime,
  });
});

// ════════════════════════════════════════════════════
// LOAD URL HANDLER
// ════════════════════════════════════════════════════

loadBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) {
    toast("Please enter a video URL.", "error");
    return;
  }

  if (url.includes("youtube") || url.includes("youtu.be")) {
    loadYouTube(url);
  } else {
    loadHTML5(url);
  }

  socket.emit("change-video", { roomId: ROOM_ID, url });
  urlInput.value = "";
});

urlInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") loadBtn.click();
});

// ════════════════════════════════════════════════════
// VIDEO CONTROLS
// ════════════════════════════════════════════════════

function setPlayIcon(isPlaying) {
  iconPlay.style.display = isPlaying ? "none" : "block";
  iconPause.style.display = isPlaying ? "block" : "none";
}

ppBtn.addEventListener("click", () => {
  if (videoType === "youtube") {
    if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  } else if (videoType === "html5") {
    if (h5Video.paused) {
      h5Video.play();
    } else {
      h5Video.pause();
    }
  }
});

// Seek bar
seekBar.addEventListener("input", () => {
  if (remoteCtrl) return;
  const newTime = (parseFloat(seekBar.value) / 100) * h5Video.duration;
  h5Video.currentTime = newTime;
  socket.emit("seek-video", {
    roomId: ROOM_ID,
    currentTime: newTime,
  });
});

h5Video.addEventListener("timeupdate", () => {
  const pct = (h5Video.currentTime / h5Video.duration) * 100;
  seekFill.style.width = pct + "%";
  timeCur.textContent = formatTime(h5Video.currentTime);
});

h5Video.addEventListener("loadedmetadata", () => {
  timeDur.textContent = formatTime(h5Video.duration);
  seekBar.max = 100;
});

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Mute
muteBtn.addEventListener("click", () => {
  h5Video.muted = !h5Video.muted;
  muteBtn.textContent = h5Video.muted ? "🔇" : "🔊";
});

// Volume
volSlider.addEventListener("input", () => {
  h5Video.volume = parseFloat(volSlider.value) / 100;
});

// Fullscreen
fsBtn.addEventListener("click", () => {
  if (videoWrap.requestFullscreen) {
    videoWrap.requestFullscreen();
  }
});

// ════════════════════════════════════════════════════
// USERS LIST
// ════════════════════════════════════════════════════

function updateUsersList() {
  usersList.innerHTML = "";
  userBadge.textContent = users.length;
  viewerCnt.textContent = users.length;

  users.forEach((user) => {
    const li = document.createElement("li");
    const icon = user.hasCamera ? "📷" : "👤";
    li.textContent = `${icon} ${user.username}`;
    if (user.id === me?.id) li.className = "me";
    usersList.appendChild(li);
  });
}

// ════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════

function addChatMessage(msg) {
  const div = document.createElement("div");
  div.className = "chat-msg";
  div.innerHTML = `<strong>${escapeHtml(msg.username)}:</strong> ${escapeHtml(msg.message)}`;
  chatMsgs.appendChild(div);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

sendBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", { roomId: ROOM_ID, message: text });
  chatInput.value = "";
});

chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// ════════════════════════════════════════════════════
// REACTIONS
// ════════════════════════════════════════════════════

const reactionEmojis = ["❤️", "😂", "😮", "😢", "🔥", "👍"];

function showReactions() {
  const btn = document.createElement("div");
  btn.className = "reaction-picker";
  reactionEmojis.forEach((emoji) => {
    const span = document.createElement("span");
    span.textContent = emoji;
    span.addEventListener("click", () => {
      socket.emit("reaction", { roomId: ROOM_ID, emoji });
      btn.remove();
    });
    btn.appendChild(span);
  });
  reactionLayer.appendChild(btn);
  setTimeout(() => btn.remove(), 5000);
}

// Find reaction button in controls and add listener
const reactBtn = document.querySelector("[data-action='react']");
if (reactBtn) {
  reactBtn.addEventListener("click", showReactions);
}

// ════════════════════════════════════════════════════
// CAMERA / WEBRTC
// ════════════════════════════════════════════════════

camBtn.addEventListener("click", async () => {
  if (isCam) {
    // Turn off
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;
    isCam = false;
    camBtnText.textContent = "📷 On";
    document.getElementById("local-video")?.remove();
    socket.emit("camera-toggle", { roomId: ROOM_ID, enabled: false });
  } else {
    // Turn on
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      isCam = true;
      camBtnText.textContent = "📷 Off";

      const video = document.createElement("video");
      video.id = "local-video";
      video.srcObject = localStream;
      video.autoplay = true;
      video.muted = true;
      camGrid.insertBefore(video, noCams);

      socket.emit("camera-toggle", { roomId: ROOM_ID, enabled: true });

      // WebRTC offers
      users.forEach((user) => {
        if (user.id !== me.id) {
          initiateWebRTC(user.id);
        }
      });
    } catch (error) {
      toast("Camera access denied.", "error");
      isCam = false;
      camBtnText.textContent = "📷 On";
    }
  }
});

async function initiateWebRTC(peerId) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice", {
        targetId: peerId,
        candidate: event.candidate,
      });
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    const video = document.createElement("video");
    video.id = `video-${peerId}`;
    video.srcObject = event.streams[0];
    video.autoplay = true;
    video.playsinline = true;
    camGrid.appendChild(video);
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("webrtc-offer", {
    targetId: peerId,
    offer: peerConnection.localDescription,
  });

  peers.set(peerId, peerConnection);
}

// ════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════

sidebarToggle.addEventListener("click", () => {
  sidebarInner.classList.toggle("hidden");
});

// ════════════════════════════════════════════════════
// ROOM ID COPY
// ════════════════════════════════════════════════════

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(ROOM_ID);
  toast("Room code copied!", "success");
});

// ════════════════════════════════════════════════════
// LEAVE ROOM
// ════════════════════════════════════════════════════

leaveBtn.addEventListener("click", () => {
  socket.emit("leave-room");
  socket.ws.close();
  window.location.href = "/";
});

// ════════════════════════════════════════════════════
// SOCKET EVENTS
// ════════════════════════════════════════════════════

socket.on("connect", () => {
  isConnected = true;
  console.log("[v0] WebSocket connected, joining room...");

  socket.emit("join-room", {
    roomId: ROOM_ID,
    username: NAME_P,
  });
});

socket.on("disconnect", () => {
  isConnected = false;
  toast("Connection lost — reconnecting…", "error", 8000);
});

socket.on("joined-room", (msg) => {
  me = msg.me;
  users = msg.users;
  roomDisp.textContent = ROOM_ID;

  updateUsersList();
  hideOverlay();
  toast(`Welcome, ${me.username}!`, "success");
  console.log("[v0] Joined room successfully");
});

socket.on("user-joined", (msg) => {
  users = msg.users;
  updateUsersList();
  toast(`${msg.user.username} joined`, "info");
});

socket.on("user-left", (msg) => {
  users = msg.users;
  updateUsersList();
  toast(`${msg.username} left`, "info");

  // Clean up video
  const video = document.getElementById(`video-${msg.userId}`);
  if (video) video.remove();

  // Close peer connection
  const peer = peers.get(msg.userId);
  if (peer) {
    peer.close();
    peers.delete(msg.userId);
  }
});

socket.on("play-video", (msg) => {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) {
    ytPlayer.seekTo(msg.currentTime);
    ytPlayer.playVideo();
  } else if (videoType === "html5") {
    h5Video.currentTime = msg.currentTime;
    h5Video.play();
  }
  toast(`▶️ ${msg.by || "Someone"} played`, "info", 2000);
  remoteCtrl = false;
});

socket.on("pause-video", (msg) => {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) {
    ytPlayer.seekTo(msg.currentTime);
    ytPlayer.pauseVideo();
  } else if (videoType === "html5") {
    h5Video.currentTime = msg.currentTime;
    h5Video.pause();
  }
  toast(`⏸️ ${msg.by || "Someone"} paused`, "info", 2000);
  remoteCtrl = false;
});

socket.on("seek-video", (msg) => {
  remoteCtrl = true;
  if (videoType === "youtube" && ytPlayer) {
    ytPlayer.seekTo(msg.currentTime);
  } else if (videoType === "html5") {
    h5Video.currentTime = msg.currentTime;
  }
  remoteCtrl = false;
});

socket.on("video-changed", (msg) => {
  if (msg.url.includes("youtube") || msg.url.includes("youtu.be")) {
    loadYouTube(msg.url);
  } else {
    loadHTML5(msg.url);
  }
  toast(`🎬 ${msg.by || "Someone"} changed video`, "info");
});

socket.on("chat-message", (msg) => {
  addChatMessage(msg);
});

socket.on("reaction", (msg) => {
  const div = document.createElement("div");
  div.className = "reaction-bubble";
  div.textContent = msg.emoji;
  reactionLayer.appendChild(div);
  setTimeout(() => div.remove(), 2000);
});

socket.on("camera-toggled", (msg) => {
  users = msg.users;
  updateUsersList();
  if (msg.enabled) {
    if (isCam && msg.userId !== me.id) {
      initiateWebRTC(msg.userId);
    }
  } else {
    const video = document.getElementById(`video-${msg.userId}`);
    if (video) video.remove();
    const peer = peers.get(msg.userId);
    if (peer) {
      peer.close();
      peers.delete(msg.userId);
    }
  }
});

// WebRTC signaling
socket.on("webrtc-offer", async (msg) => {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc-ice", {
        targetId: msg.fromId,
        candidate: event.candidate,
      });
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    const video = document.createElement("video");
    video.id = `video-${msg.fromId}`;
    video.srcObject = event.streams[0];
    video.autoplay = true;
    video.playsinline = true;
    camGrid.appendChild(video);
  };

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(msg.offer)
  );

  // Process queued ICE candidates
  const candidates = iceQueue.get(msg.fromId) || [];
  candidates.forEach((c) => peerConnection.addIceCandidate(c));
  iceQueue.delete(msg.fromId);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("webrtc-answer", {
    targetId: msg.fromId,
    answer: peerConnection.localDescription,
  });

  peers.set(msg.fromId, peerConnection);
});

socket.on("webrtc-answer", async (msg) => {
  const peerConnection = peers.get(msg.fromId);
  if (peerConnection) {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(msg.answer)
    );

    const candidates = iceQueue.get(msg.fromId) || [];
    candidates.forEach((c) => peerConnection.addIceCandidate(c));
    iceQueue.delete(msg.fromId);
  }
});

socket.on("webrtc-ice", async (msg) => {
  const peerConnection = peers.get(msg.fromId);
  if (peerConnection && peerConnection.remoteDescription) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  } else {
    // Queue for later
    if (!iceQueue.has(msg.fromId)) {
      iceQueue.set(msg.fromId, []);
    }
    iceQueue.get(msg.fromId).push(new RTCIceCandidate(msg.candidate));
  }
});

// ════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════

socket.connect();
