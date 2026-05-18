# 🎬 BingeWatch

> Watch videos together with friends in real-time — no account needed, 100% anonymous.

## Features

| Feature | Details |
|---|---|
| 🔄 **Synced Playback** | Play, pause, and seek — everyone stays in sync automatically |
| 💬 **Live Chat** | Real-time chat with timestamps |
| 📹 **Facecam** | Peer-to-peer webcam/mic sharing via WebRTC |
| 😂 **Reactions** | Send floating emoji reactions over the video |
| 🔒 **Anonymous** | No login, no sign-up — just click and go |
| ▶️ **YouTube** | Paste any YouTube URL (including Shorts) |
| 🎞️ **Direct Links** | Supports `.mp4`, `.webm`, `.ogg`, `.mov`, `.m3u8` and more |
| 📱 **Responsive** | Works on desktop and mobile |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
# or for development with auto-reload:
npm run dev

# 3. Open your browser
# http://localhost:4000
```

## Netlify Deployment

Netlify can host the frontend (`public/`) while your Node.js + Socket.io server runs separately (for example on Railway/Render/Fly).

1. Deploy this repo to Netlify (it uses `netlify.toml` and publishes `public/`).
2. In Netlify Site Settings → Environment Variables, set:
   - `BINGEWATCH_SOCKET_URL=https://your-backend-domain.com`
3. Trigger a redeploy.

The frontend will then connect Socket.io to `BINGEWATCH_SOCKET_URL`. If unset, it falls back to the current origin.

## How to Use

1. **Create** a room — a 6-character code is generated
2. **Share** the invite link with friends (click the copy button in the room)
3. **Paste** a YouTube URL or any direct video link
4. Everyone watches together in perfect sync!

## WebRTC / Facecam Notes

- Facecam uses **peer-to-peer WebRTC** (no video data passes through the server)
- Works on **localhost** without HTTPS
- For **production** (HTTPS required by browsers for `getUserMedia`), deploy behind a reverse proxy with SSL
- For best connectivity across different networks, consider adding a TURN server:
  ```js
  // In public/js/room.js — ICE_CONF:
  { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
  ```

## Project Structure

```
binge watch/
├── server.js          ← Express + Socket.io backend
├── package.json
├── public/
│   ├── index.html     ← Landing page (create / join)
│   ├── room.html      ← Watch party room
│   ├── css/
│   │   ├── style.css  ← Shared styles & CSS variables
│   │   ├── landing.css
│   │   └── room.css
│   └── js/
│       ├── landing.js ← Room creation/joining logic
│       └── room.js    ← Video sync, chat, WebRTC
```

## Supported Video Sources

- `https://www.youtube.com/watch?v=...`
- `https://youtu.be/...`
- `https://youtube.com/shorts/...`
- Any direct `.mp4`, `.webm`, `.ogg`, `.m3u8` URL

## Tech Stack

- **Backend** — Node.js, Express, Socket.io
- **Video Sync** — Socket.io events (play/pause/seek broadcast)
- **Facecam** — Native WebRTC API (no extra libraries)
- **Frontend** — Vanilla JS, CSS custom properties (no frameworks)

## License

MIT
