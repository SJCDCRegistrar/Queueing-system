// Registrar Transaction Queue — backend server
// Serves the frontend (public/) and a small REST + realtime (Socket.IO) API
// so the Kiosk, Staff Window, and Now Serving Board can all run on different
// devices at the same time and stay in sync instantly.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

// ---------------------------------------------------------------------
// CONFIG — edit this section to change transaction types or window count.
// ---------------------------------------------------------------------
const TYPES = [
  { prefix: 'A', name: 'Enrollment & Registration' },
  { prefix: 'B', name: 'Transcript of Records (TOR)' },
  { prefix: 'C', name: 'Certifications & Diplomas' },
  { prefix: 'D', name: 'Corrections to Records' },
  { prefix: 'E', name: 'Other Concerns' },
];
const WINDOWS = ['1', '2', '3', '4'];
// ---------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function freshState() {
  const counters = {};
  TYPES.forEach((t) => (counters[t.prefix] = 0));
  const windows = {};
  WINDOWS.forEach((w) => (windows[w] = { ticketId: null }));
  return { date: todayStr(), counters, tickets: [], windows };
}

let state;
let writeChain = Promise.resolve();

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && parsed.date === todayStr()) {
        state = parsed;
        return;
      }
    }
  } catch (e) {
    console.error('Could not read existing state file, starting fresh:', e.message);
  }
  state = freshState();
  persist();
}

function persist() {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve) => {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = STATE_FILE + '.tmp';
        fs.writeFile(tmp, JSON.stringify(state, null, 2), (err) => {
          if (err) {
            console.error('Failed to write state file:', err.message);
            return resolve();
          }
          fs.rename(tmp, STATE_FILE, () => resolve());
        });
      })
  );
  return writeChain;
}

// If the calendar day has rolled over, start a fresh queue automatically.
function checkNewDay() {
  if (state.date !== todayStr()) {
    state = freshState();
    persist();
    io.emit('state', state);
  }
}

async function mutate(fn) {
  checkNewDay();
  fn();
  await persist();
  io.emit('state', state);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ types: TYPES, windows: WINDOWS });
});

app.get('/api/state', (req, res) => {
  checkNewDay();
  res.json(state);
});

app.post('/api/ticket', async (req, res) => {
  const { prefix } = req.body || {};
  const typeInfo = TYPES.find((t) => t.prefix === prefix);
  if (!typeInfo) return res.status(400).json({ error: 'Unknown transaction type' });

  let ticket;
  await mutate(() => {
    state.counters[prefix] += 1;
    const num = state.counters[prefix];
    ticket = {
      id: prefix + '-' + num + '-' + Date.now(),
      prefix,
      number: num,
      label: prefix + '-' + String(num).padStart(3, '0'),
      typeName: typeInfo.name,
      status: 'waiting',
      createdAt: Date.now(),
      calledAt: null,
      completedAt: null,
      window: null,
    };
    state.tickets.push(ticket);
  });
  res.json(ticket);
});

app.post('/api/call', async (req, res) => {
  const { window } = req.body || {};
  if (!WINDOWS.includes(window)) return res.status(400).json({ error: 'Unknown window' });

  await mutate(() => {
    if (state.windows[window].ticketId) return; // finish current ticket first
    const waiting = state.tickets
      .filter((t) => t.status === 'waiting')
      .sort((a, b) => a.createdAt - b.createdAt);
    if (waiting.length === 0) return;
    const next = waiting[0];
    next.status = 'serving';
    next.calledAt = Date.now();
    next.window = window;
    state.windows[window].ticketId = next.id;
  });
  res.json(state);
});

app.post('/api/complete', async (req, res) => {
  const { window } = req.body || {};
  if (!WINDOWS.includes(window)) return res.status(400).json({ error: 'Unknown window' });

  await mutate(() => {
    const id = state.windows[window] && state.windows[window].ticketId;
    if (!id) return;
    const t = state.tickets.find((x) => x.id === id);
    if (t) {
      t.status = 'done';
      t.completedAt = Date.now();
    }
    state.windows[window].ticketId = null;
  });
  res.json(state);
});

app.post('/api/skip', async (req, res) => {
  const { window } = req.body || {};
  if (!WINDOWS.includes(window)) return res.status(400).json({ error: 'Unknown window' });

  await mutate(() => {
    const id = state.windows[window] && state.windows[window].ticketId;
    if (!id) return;
    const t = state.tickets.find((x) => x.id === id);
    if (t) {
      t.status = 'skipped';
      t.completedAt = Date.now();
    }
    state.windows[window].ticketId = null;
  });
  res.json(state);
});

// Manual reset (e.g. for testing, or starting a new session mid-day).
app.post('/api/reset', async (req, res) => {
  await mutate(() => {
    state = freshState();
  });
  res.json(state);
});

io.on('connection', (socket) => {
  // Send the current state immediately to any newly connected device.
  socket.emit('state', state);
});

loadState();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Registrar Queue System running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
});
