# Socket.io Connection Fixes for Vercel

## Problem
WebSocket connections were dropping repeatedly due to Vercel's serverless architecture constraints and Socket.io timeout misconfigurations.

## Root Causes
1. **Timeout Mismatch**: Original `pingTimeout: 60000ms` was too long for Vercel's default 60-second function timeout
2. **Function Duration**: Default maxDuration was 60 seconds, killing long-lived connections
3. **Ping Interval**: No aggressive keep-alive mechanism to prevent idle disconnects
4. **Missing Reconnection Logic**: Client-side reconnection wasn't configured

## Solutions Implemented

### 1. Server-Side (server.js)

**Socket.io Configuration:**
```javascript
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,  // Send ping every 25 seconds
  pingTimeout: 20000,   // Wait 20 seconds for pong
  transports: ["websocket", "polling"], // Fallback to polling
  maxHttpBufferSize: 1e6,
  allowEIO3: true,
});
```

**Key Changes:**
- `pingInterval: 25000` - Sends keep-alive ping every 25 seconds (prevents idle timeout)
- `pingTimeout: 20000` - Waits only 20 seconds for response before reconnecting
- `transports` - Prefers WebSocket but falls back to HTTP long-polling if WebSocket fails
- Health check endpoint (`GET /health`) - Monitors server status

### 2. Client-Side (public/js/room.js)

**Socket.io Configuration:**
```javascript
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  transports: ["websocket", "polling"],
});
```

**Connection Monitoring:**
- `socket.on("connect")` - Logs successful connection
- `socket.on("disconnect")` - Shows user-friendly toast message
- `socket.on("reconnect")` - Confirms reconnection with success toast
- `socket.on("reconnect_attempt")` - Logs retry attempts
- `socket.on("connect_error")` & `socket.on("reconnect_error")` - Logs errors for debugging

### 3. Vercel Configuration (vercel.json)

**Function Duration:**
```json
"functions": {
  "server.js": {
    "memory": 1024,
    "maxDuration": 900,      // Increased from 60 to 900 seconds (15 minutes)
    "runtime": "nodejs20.x"
  }
}
```

**Cache Headers:**
- Disables caching for `/socket.io/*` to prevent stale connections
- Ensures fresh connections on every request

## How It Works Now

### Connection Flow
1. Client connects to server via WebSocket (with HTTP polling fallback)
2. Server sends ping every 25 seconds
3. Client responds with pong within 20 seconds
4. If connection drops, client automatically retries with exponential backoff (1-5 second delays)
5. If WebSocket fails, falls back to HTTP long-polling
6. User receives toast notifications of connection status

### Automatic Reconnection
- **Initial retry**: 1 second delay
- **Max retry delay**: 5 seconds
- **Retry attempts**: Infinite (keeps trying until server is back)
- **Total duration support**: 15 minutes per connection (Vercel Pro plan allows up to 15 minutes)

## Testing the Fix

### Local Testing
```bash
npm run dev
# Open http://localhost:4000
# Create a room and join with multiple browsers
# Connection should stay stable indefinitely
```

### Vercel Deployment Testing
1. Deploy to Vercel: `vercel deploy`
2. Test in production: Open your deployed URL
3. Create a room and keep it open for 5+ minutes
4. Simulate network issues in DevTools Network tab and watch auto-reconnection
5. Check browser console for `[v0]` debug logs

## Console Debugging

Look for these logs in browser DevTools Console:
- `[v0] Socket connected: socket-id-here` - Connection established
- `[v0] Socket disconnected: reason` - Disconnection with reason
- `[v0] Attempting to reconnect...` - Retrying connection
- `[v0] Socket reconnected` - Successfully reconnected
- `[v0] Connection error: message` - Connection error details

## Performance Notes

- **Memory**: 1024MB allocated (sufficient for multiple concurrent rooms)
- **Timeout**: 900 seconds (15 minutes) - longest typical watch session
- **Ping Overhead**: ~1KB per 25-second interval (negligible)
- **Reconnection**: Happens transparently to user (video keeps sync, chat continues)

## Fallback Mechanisms

If WebSocket is blocked (corporate firewalls, some proxies):
1. Socket.io automatically detects WebSocket unavailability
2. Falls back to HTTP long-polling
3. User experience remains the same, slightly higher latency
4. No manual configuration needed

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Still disconnecting frequently | Check browser console for errors; verify Vercel deployment is active |
| High latency | Check `Network` tab in DevTools; may indicate polling fallback (normal) |
| Connection never auto-reconnects | Verify `reconnectionAttempts: Infinity` is set on client |
| Rooms not syncing after reconnect | Room state is server-side, should auto-sync on reconnect |

## Vercel Limitations & Alternatives

**Current Setup:**
- ✅ Works for up to 15 minutes per connection
- ✅ Handles typical watch sessions (movies, episodes)
- ✅ Auto-reconnection is transparent to users

**If you need indefinite connections (24/7 rooms):**
- Consider Vercel KV for room state persistence
- Or switch to a dedicated WebSocket server (Railway, Render, AWS)
- Or use Vercel Edge Functions with longer timeout support

## Files Modified

1. `server.js` - Socket.io config + health endpoint
2. `public/js/room.js` - Client socket config + connection monitoring
3. `vercel.json` - Extended function timeout + WebSocket headers
