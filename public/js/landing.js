/* ════════════════════════════════════════════════════
   BingeWatch — Landing Page
   ════════════════════════════════════════════════════ */

const socket = io();

// ── Helpers ─────────────────────────────────────────
function toast(msg, type = 'info', dur = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = 'toast'), dur);
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
  params.set('room', roomId);
  if (username) params.set('name', username);
  window.location.href = `/room.html?${params.toString()}`;
}

// ── Check for invite link ────────────────────────────
const urlParams   = new URLSearchParams(window.location.search);
const inviteRoom  = urlParams.get('room');

if (inviteRoom) {
  const code = inviteRoom.toUpperCase().trim();
  document.getElementById('join-code').value = code;
  document.getElementById('join-name').focus();

  const banner   = document.getElementById('invite-banner');
  const roomDisp = document.getElementById('invite-room-display');
  roomDisp.textContent = code;
  banner.style.display = 'flex';

  // Scroll to join card
  document.querySelector('.card-join').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Auto-uppercase & sanitize room code input ────────
document.getElementById('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ── CREATE ROOM ──────────────────────────────────────
const createBtn      = document.getElementById('create-btn');
const createBtnHTML  = createBtn.innerHTML;

createBtn.addEventListener('click', handleCreate);
document.getElementById('create-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreate();
});

function handleCreate() {
  const username = document.getElementById('create-name').value.trim();
  setLoading(createBtn, true, createBtnHTML);

  socket.emit('create-room', ({ success, roomId }) => {
    if (success) {
      goToRoom(roomId, username);
    } else {
      toast('Could not create room. Please try again.', 'error');
      setLoading(createBtn, false, createBtnHTML);
    }
  });
}

// ── JOIN ROOM ────────────────────────────────────────
const joinBtn     = document.getElementById('join-btn');
const joinBtnHTML = joinBtn.innerHTML;

joinBtn.addEventListener('click', handleJoin);
document.getElementById('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});
document.getElementById('join-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});

function handleJoin() {
  const code     = document.getElementById('join-code').value.trim().toUpperCase();
  const username = document.getElementById('join-name').value.trim();

  if (!code) {
    toast('Please enter a room code.', 'error');
    document.getElementById('join-code').focus();
    return;
  }
  if (code.length < 4) {
    toast('Room codes are at least 4 characters.', 'error');
    document.getElementById('join-code').focus();
    return;
  }

  setLoading(joinBtn, true, joinBtnHTML);

  socket.emit('check-room', code, ({ exists }) => {
    if (exists) {
      goToRoom(code, username);
    } else {
      toast(`Room "${code}" not found. Check the code and try again.`, 'error');
      setLoading(joinBtn, false, joinBtnHTML);
      document.getElementById('join-code').focus();
    }
  });
}

// ── Socket connection feedback ───────────────────────
socket.on('disconnect', () => toast('Connection lost — reconnecting…', 'error', 5000));
socket.on('connect',    () => { /* all good */ });
