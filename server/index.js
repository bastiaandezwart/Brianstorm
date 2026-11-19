import http from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { MAX_VOTES_PER_MEMBER, OPPORTUNITY_STAGES, PHASES, ROLES, TEMPLATES, membersFromEnv } from './config.js';
import { createStore } from './store.js';
import { ActionError, applyAction, createBoard } from './actions.js';
import { AiError, aiEnabled, ask, challengeIdea, generateIdeas, summarize } from './ai.js';
import { boardToMarkdown } from './export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TEAM_CODE = process.env.TEAM_CODE || '';
const DATA_FILE = process.env.DATA_FILE || path.join(here, '..', 'data', 'brainstorm.json');
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';

const store = createStore(DATA_FILE);
store.state.memberNames ??= {};

function members() {
  return membersFromEnv().map((m) => ({ ...m, name: store.state.memberNames[m.id] || m.name }));
}

// ---------- Authenticatie (gedeelde teamcode + keuze van partner) ----------

function codeMatches(input) {
  if (!TEAM_CODE) return true;
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(TEAM_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function memberFromRequest(req) {
  const token = parseCookies(req.headers.cookie).bs_session;
  const session = token && store.state.sessions[token];
  return session && members().some((m) => m.id === session.memberId) ? session.memberId : null;
}

function requireMember(req, res, next) {
  const memberId = memberFromRequest(req);
  if (!memberId) return res.status(401).json({ error: 'Niet ingelogd.' });
  req.memberId = memberId;
  next();
}

// ---------- Realtime ----------

const sockets = new Set(); // { ws, memberId, boardId }

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function boardSummary(b) {
  return {
    id: b.id,
    title: b.title,
    question: b.question,
    template: b.template,
    phase: b.phase,
    archived: b.archived,
    createdAt: b.createdAt,
    createdBy: b.createdBy,
    updatedAt: b.updatedAt,
    ideaCount: b.ideas.length,
    openActions: b.actions.filter((a) => !a.done).length,
  };
}

function globalPayload() {
  return {
    type: 'global',
    boards: Object.values(store.state.boards).map(boardSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    opportunities: store.state.opportunities,
    members: members(),
    online: [...new Set([...sockets].map((s) => s.memberId))],
  };
}

function broadcastGlobal() {
  const msg = globalPayload();
  for (const s of sockets) send(s.ws, msg);
}

function broadcastBoard(board) {
  for (const s of sockets) if (s.boardId === board.id) send(s.ws, { type: 'board', board });
}

function broadcastPresence(boardId) {
  if (!boardId) return;
  const here = [...new Set([...sockets].filter((s) => s.boardId === boardId).map((s) => s.memberId))];
  for (const s of sockets) if (s.boardId === boardId) send(s.ws, { type: 'presence', boardId, members: here });
}

function broadcastAiBusy(boardId, busy) {
  for (const s of sockets) if (s.boardId === boardId) send(s.ws, { type: 'ai-busy', boardId, ...busy });
}

function changed(result) {
  store.save();
  if (result.board) broadcastBoard(result.board);
  broadcastGlobal();
}

// ---------- HTTP ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(here, '..', 'public')));
app.get('/vendor/morphdom.js', (req, res) =>
  res.sendFile(path.join(here, '..', 'node_modules', 'morphdom', 'dist', 'morphdom-esm.js')),
);

app.get('/api/config', (req, res) => {
  res.json({
    roles: ROLES,
    phases: PHASES,
    templates: TEMPLATES,
    stages: OPPORTUNITY_STAGES,
    members: members(),
    maxVotes: MAX_VOTES_PER_MEMBER,
    aiEnabled: aiEnabled(),
    needsCode: Boolean(TEAM_CODE),
    me: memberFromRequest(req),
  });
});

app.post('/api/login', (req, res) => {
  const { code, memberId } = req.body ?? {};
  if (!codeMatches(code)) return res.status(403).json({ error: 'Onjuiste teamcode.' });
  if (!members().some((m) => m.id === memberId)) return res.status(400).json({ error: 'Kies wie je bent.' });
  const token = randomBytes(24).toString('hex');
  store.state.sessions[token] = { memberId, createdAt: new Date().toISOString() };
  store.save();
  res.setHeader(
    'Set-Cookie',
    `bs_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${SECURE_COOKIE ? '; Secure' : ''}`,
  );
  res.json({ ok: true, me: memberId });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).bs_session;
  if (token) delete store.state.sessions[token];
  store.save();
  res.setHeader('Set-Cookie', 'bs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/state', requireMember, (req, res) => res.json(globalPayload()));

app.get('/api/boards/:id', requireMember, (req, res) => {
  const board = store.state.boards[req.params.id];
  if (!board) return res.status(404).json({ error: 'Sessie niet gevonden.' });
  res.json(board);
});

app.post('/api/boards', requireMember, (req, res) => {
  const board = createBoard(store.state, req.body ?? {}, req.memberId);
  changed({});
  res.status(201).json(board);
});

app.delete('/api/boards/:id', requireMember, (req, res) => {
  if (!store.state.boards[req.params.id]) return res.status(404).json({ error: 'Sessie niet gevonden.' });
  delete store.state.boards[req.params.id];
  changed({});
  res.json({ ok: true });
});

app.post('/api/members/:id/name', requireMember, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  if (!members().some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Onbekende partner.' });
  if (name) store.state.memberNames[req.params.id] = name;
  else delete store.state.memberNames[req.params.id];
  changed({});
  res.json({ ok: true });
});

app.post('/api/action', requireMember, (req, res) => {
  try {
    const result = applyAction(store.state, req.body ?? {}, req.memberId);
    changed(result);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ActionError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get('/api/boards/:id/export.md', requireMember, (req, res) => {
  const board = store.state.boards[req.params.id];
  if (!board) return res.status(404).send('Sessie niet gevonden.');
  const filename = board.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'sessie';
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
  res.send(boardToMarkdown(board, members()));
});

// ---------- AI ----------

const aiRunning = new Map(); // boardId -> kind

function aiRoute(kind, run) {
  return async (req, res) => {
    const board = store.state.boards[req.params.id];
    if (!board) return res.status(404).json({ error: 'Sessie niet gevonden.' });
    if (aiRunning.has(board.id)) return res.status(409).json({ error: 'De AI is al bezig voor deze sessie.' });
    aiRunning.set(board.id, kind);
    broadcastAiBusy(board.id, { kind, by: req.memberId, busy: true });
    try {
      const result = await run(board, req);
      board.updatedAt = new Date().toISOString();
      changed({ board });
      res.json({ ok: true, result });
    } catch (err) {
      if (err instanceof AiError) return res.status(502).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Er ging iets mis met de AI.' });
    } finally {
      aiRunning.delete(board.id);
      broadcastAiBusy(board.id, { kind, busy: false });
    }
  };
}

app.post(
  '/api/boards/:id/ai/ideas',
  requireMember,
  aiRoute('ideas', async (board, req) => {
    const count = Math.min(12, Math.max(3, Number(req.body?.count) || 8));
    const focus = String(req.body?.focus ?? '').slice(0, 300);
    const ideas = await generateIdeas(board, members(), { count, focus });
    board.aiSuggestions ??= [];
    for (const idea of ideas) {
      const cluster = board.clusters.find((c) => c.name.toLowerCase() === String(idea.cluster).toLowerCase());
      board.aiSuggestions.push({
        id: randomBytes(4).toString('hex'),
        text: String(idea.text).slice(0, 280),
        details: String(idea.details ?? '').slice(0, 2000),
        lens: ROLES[idea.lens] ? idea.lens : null,
        clusterId: cluster?.id ?? board.clusters[0]?.id,
        requestedBy: req.memberId,
      });
    }
    return { added: ideas.length };
  }),
);

app.post(
  '/api/boards/:id/ai/challenge',
  requireMember,
  aiRoute('challenge', async (board, req) => {
    const result = await challengeIdea(board, members(), req.body?.ideaId);
    const idea = board.ideas.find((i) => i.id === req.body?.ideaId);
    if (idea) idea.aiChallenge = { ...result, createdAt: new Date().toISOString(), requestedBy: req.memberId };
    return result;
  }),
);

app.post(
  '/api/boards/:id/ai/summary',
  requireMember,
  aiRoute('summary', async (board, req) => {
    const text = await summarize(board, members());
    board.aiSummary = { text, createdAt: new Date().toISOString(), requestedBy: req.memberId };
    return board.aiSummary;
  }),
);

app.post(
  '/api/boards/:id/ai/ask',
  requireMember,
  aiRoute('ask', async (board, req) => {
    const question = String(req.body?.question ?? '').trim().slice(0, 2000);
    if (!question) throw new AiError('Stel eerst een vraag.');
    board.aiThread ??= [];
    const answer = await ask(board, members(), question, board.aiThread);
    board.aiThread.push({ question, answer, by: req.memberId, createdAt: new Date().toISOString() });
    board.aiThread = board.aiThread.slice(-30);
    return { answer };
  }),
);

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(here, '..', 'public', 'index.html')));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Interne fout.' });
});

// ---------- WebSocket ----------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const memberId = memberFromRequest(req);
  if (!memberId) return ws.close(4401, 'Niet ingelogd');
  const entry = { ws, memberId, boardId: null };
  sockets.add(entry);
  send(ws, globalPayload());
  broadcastGlobal();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'subscribe') {
      const previous = entry.boardId;
      const board = store.state.boards[msg.boardId];
      entry.boardId = board ? board.id : null;
      if (board) {
        send(ws, { type: 'board', board });
        if (aiRunning.has(board.id)) send(ws, { type: 'ai-busy', boardId: board.id, kind: aiRunning.get(board.id), busy: true });
      }
      broadcastPresence(previous);
      broadcastPresence(entry.boardId);
    }
  });

  ws.on('close', () => {
    sockets.delete(entry);
    broadcastPresence(entry.boardId);
    broadcastGlobal();
  });
});

// Houd verbindingen levend achter proxies.
setInterval(() => {
  for (const s of sockets) if (s.ws.readyState === s.ws.OPEN) s.ws.ping();
}, 30_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    store.flush();
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Brainstorm draait op http://localhost:${PORT}`);
  if (!TEAM_CODE) console.warn('Let op: TEAM_CODE is niet gezet; iedereen met de link kan inloggen.');
  if (!aiEnabled()) console.log('AI-sparringpartner staat uit (geen ANTHROPIC_API_KEY).');
});
