# Registrar Transaction Queue

A live, multi-device queueing system for the Office of the Registrar (St. Jude
College / PHINMA Education). Three screens share one live queue in real time:

- **Kiosk** (`/#kiosk`) — visitors pick a transaction type and get a ticket number.
- **Staff Window** (`/#staff`) — staff pick their window and call/complete/skip tickets.
- **Now Serving Board** (`/#board`) — public display for the waiting area.

Because it's a real backend (not just a browser tab), you can open the Kiosk on
a tablet at the entrance, Staff Window on 2–4 counter computers, and the Board
on a TV — all at the same time, all staying in sync instantly.

## How it works

- **Backend:** Node.js + Express + Socket.IO (`server.js`)
- **Storage:** a single JSON file (`data/state.json`) — no database setup needed
- **Sync:** every action (new ticket, call next, complete, skip) is broadcast
  instantly to every connected device via WebSocket (Socket.IO); each screen
  also does a normal REST fetch on load so nothing is missed
- **Daily reset:** ticket numbers automatically restart at 1 every calendar day

## Running it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Add `#kiosk`, `#staff`, or
`#board` to the URL to jump straight to that screen (helpful for bookmarking
on dedicated devices).

## Changing transaction types or window count

Open `server.js` and edit the `TYPES` and `WINDOWS` arrays near the top of the
file, then restart the server. The frontend reads this config automatically
from the server — no need to touch `public/index.html`.

```js
const TYPES = [
  { prefix: 'A', name: 'Enrollment & Registration' },
  { prefix: 'B', name: 'Transcript of Records (TOR)' },
  // add / remove / rename as needed
];
const WINDOWS = ['1', '2', '3', '4']; // add more window numbers as needed
```

## Deploying so it's reachable from other devices/network

Pick whichever fits what you already have:

### Option A — A small VPS or an existing school server (recommended for full control)
1. Copy this folder to the server.
2. `npm install --production`
3. Run it persistently with a process manager, e.g. [PM2](https://pm2.keymetrics.io/):
   ```bash
   npm install -g pm2
   pm2 start server.js --name registrar-queue
   pm2 save
   pm2 startup   # follow the printed instructions so it survives reboots
   ```
4. Put it behind your existing web server (nginx/Apache) as a reverse proxy on
   port 80/443 if you want a clean URL and HTTPS, or just open the port
   directly on your local network (e.g. `http://192.168.1.50:3000`) if it only
   needs to be reachable inside the campus network.

### Option B — Render.com / Railway.app (fastest, minimal setup)
1. Push this folder to a GitHub repo.
2. Create a new "Web Service" and point it at the repo.
3. Build command: `npm install` — Start command: `npm start`.
4. **Important:** these platforms' default filesystem is *not* persistent
   across deploys/restarts. Attach a **persistent disk/volume** mounted at
   `/data` (Render calls this a "Disk"), and set an environment variable
   `DATA_DIR=/data` — then update the one line in `server.js`
   (`const DATA_DIR = ...`) to read `process.env.DATA_DIR || path.join(__dirname, 'data')`.
   Without this, a redeploy or restart will wipe the day's queue.

### Option C — Docker
A minimal `Dockerfile` (not included by default, ask if you'd like one added)
would be:
```dockerfile
FROM node:18-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
VOLUME ["/app/data"]
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
```

## Security note

There is currently **no login/authentication** on the Staff Window screen —
anyone with the URL can call/complete tickets. For real deployment, consider
one of:
- Restricting access at the network level (only reachable on campus Wi-Fi/LAN)
- Putting `/#staff` behind a reverse-proxy basic-auth rule (nginx `auth_basic`)
- Asking me to add a simple staff PIN/login screen

## Data & backups

All queue data lives in `data/state.json`. It's plain JSON, so you can open it
in any text editor, or copy it out periodically as a backup. Deleting it (or
using `POST /api/reset`) starts a brand-new empty queue.
