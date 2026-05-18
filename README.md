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

### Local Development

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

### Deploy to Vercel

```bash
# 1. Push to GitHub
git add .
git commit -m "Deploy BingeWatch"
git push

# 2. Import your repo on vercel.com
# https://vercel.com/new

# 3. Click Deploy
```

Or use the Vercel CLI:

```bash
npm i -g vercel
vercel
```

**Note:** Native WebSocket connections work seamlessly on Vercel with no additional configuration needed.

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

- **Backend** — Node.js, Express, Native WebSocket API (ws package)
- **Video Sync** — WebSocket JSON messages (play/pause/seek broadcast)
- **Facecam** — Native WebRTC API (no extra libraries)
- **Frontend** — Vanilla JS, CSS custom properties (no frameworks)

## License

MIT
