import morphdom from '/vendor/morphdom.js';

// ---------------------------------------------------------------------------
// Toestand
// ---------------------------------------------------------------------------
const S = {
  config: null,
  me: null,
  global: { boards: [], opportunities: [], members: [], online: [] },
  board: null,
  presence: [],
  aiBusy: null,
  route: { name: 'home' },
  ui: {
    openIdea: null,
    lensFilter: null,
    showParked: false,
    showArchived: false,
    newBoard: false,
    template: 'horizon',
    editHeader: false,
  },
  drafts: {},
};

const root = document.getElementById('app');

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attr = esc;
const roles = () => S.config.roles;
const roleKeys = () => Object.keys(S.config.roles);
const members = () => (S.global.members.length ? S.global.members : S.config.members);
const member = (id) => members().find((m) => m.id === id) ?? { id, name: id, role: id };
const firstName = (id) => member(id).name.split(' ')[0];
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const avg = (l) => {
  const v = l.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const draft = (k, fallback = '') => S.drafts[k] ?? fallback;

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)[0] : parts[0]?.[1] ?? '')).toUpperCase();
}

function avatar(id, { size = '', online = null } = {}) {
  const m = member(id);
  const r = roles()[m.role];
  const cls = ['avatar', size, online === true && 'online', online === false && 'offline'].filter(Boolean).join(' ');
  return `<span class="${cls}" style="--c:${r?.color}" title="${attr(`${m.name} — ${r?.label ?? ''}`)}">${esc(initials(m.name))}</span>`;
}

function lensTag(key) {
  const r = roles()[key];
  return r ? `<span class="tag" style="--c:${r.color}">${esc(r.short)} · ${esc(r.lens)}</span>` : '';
}

function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'zojuist';
  if (s < 3600) return `${Math.floor(s / 60)} min geleden`;
  if (s < 86400) return `${Math.floor(s / 3600)} uur geleden`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} dagen geleden`;
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Minimale, veilige Markdown-weergave voor AI-antwoorden.
function md(src) {
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of String(src ?? '').split('\n')) {
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)/))) {
      closeList();
      out.push(`<h3>${inline(m[1])}</h3>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return `<div class="md">${out.join('')}</div>`;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}
const toastError = (err) => toast(err.message || String(err), 'error');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me) {
    S.me = null;
    render();
  }
  if (!res.ok) throw new Error(data.error || 'Er ging iets mis.');
  return data;
}

const act = (type, payload = {}, boardId = S.board?.id) => api('POST', '/api/action', { type, payload, boardId }).catch(toastError);

// ---------------------------------------------------------------------------
// Routing & realtime
// ---------------------------------------------------------------------------
function parseRoute() {
  const [, kind, id, tab] = location.hash.split('/');
  if (kind === 'b' && id) return { name: 'board', id, tab: tab || 'ideeen' };
  return { name: 'home' };
}

function go(hash) {
  location.hash = hash;
}

window.addEventListener('hashchange', () => {
  const prev = S.route;
  S.route = parseRoute();
  if (S.route.name !== 'board' || prev.id !== S.route.id) {
    S.board = null;
    S.presence = [];
    S.aiBusy = null;
    S.ui.openIdea = null;
    S.ui.editHeader = false;
    subscribe();
  }
  render();
  window.scrollTo(0, 0);
});

let ws = null;
let retry = 0;
function connect() {
  if (!S.me) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    subscribe();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'global') {
      S.global = msg;
    } else if (msg.type === 'board' && S.route.id === msg.board.id) {
      S.board = msg.board;
    } else if (msg.type === 'presence' && msg.boardId === S.route.id) {
      S.presence = msg.members;
    } else if (msg.type === 'ai-busy' && msg.boardId === S.route.id) {
      S.aiBusy = msg.busy ? msg : null;
    }
    render();
  };
  ws.onclose = (e) => {
    if (e.code === 4401) {
      S.me = null;
      render();
      return;
    }
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
  };
}

function subscribe() {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', boardId: S.route.name === 'board' ? S.route.id : null }));
}

// ---------------------------------------------------------------------------
// Weergave: gedeeld
// ---------------------------------------------------------------------------
function appbar() {
  const online = new Set(S.global.online);
  return `
  <header class="appbar">
    <a class="brand" href="#/">💡 Brainstorm</a>
    <span class="spacer"></span>
    <div class="avatars hide-sm" title="Wie is er online">
      ${members().map((m) => avatar(m.id, { size: 'sm', online: online.has(m.id) })).join('')}
    </div>
    <span class="muted small hide-sm">Ingelogd als <strong>${esc(member(S.me).name)}</strong></span>
    <button class="ghost sm" data-action="logout">Uitloggen</button>
  </header>`;
}

function render() {
  let html;
  if (!S.config) html = '<div class="loading">Laden…</div>';
  else if (!S.me) html = renderLogin();
  else if (S.route.name === 'board') html = appbar() + renderBoard();
  else html = appbar() + renderHome();

  morphdom(root, `<div id="app">${html}</div>`, {
    onBeforeElUpdated(from, to) {
      // Niet overschrijven waar iemand op dit moment in typt.
      if (from === document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(from.tagName)) return false;
      return !from.isEqualNode(to);
    },
  });
  tickTimer();
}

// ---------------------------------------------------------------------------
// Inloggen
// ---------------------------------------------------------------------------
function renderLogin() {
  return `
  <div class="login">
    <div class="login-card panel">
      <h1>💡 Brainstorm</h1>
      <p class="muted">De plek waar we met z'n vieren sparren over nieuwe kansen — elk vanuit onze eigen expertise.</p>
      ${
        S.config.needsCode
          ? `<label for="code">Teamcode</label>
             <input id="code" type="password" autocomplete="current-password" data-draft="login.code" value="${attr(draft('login.code'))}" placeholder="Gedeelde code van het team">`
          : ''
      }
      <p class="muted small" style="margin-top:1rem">Wie ben jij?</p>
      <div class="member-pick">
        ${members()
          .map((m) => {
            const r = roles()[m.role];
            return `<button data-action="login" data-id="${m.id}">
              ${avatar(m.id, { size: 'lg' })}
              <span><strong>${esc(m.name)}</strong><span class="muted small">${esc(r.label)} · ${esc(r.lens)}</span></span>
            </button>`;
          })
          .join('')}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Startpagina
// ---------------------------------------------------------------------------
function renderHome() {
  const boards = S.global.boards.filter((b) => b.archived === S.ui.showArchived);
  const phaseLabel = (k) => S.config.phases.find((p) => p.key === k)?.label ?? k;
  return `
  <main class="page">
    <div class="hero">
      <div>
        <h1>Hoi ${esc(firstName(S.me))} 👋</h1>
        <p class="muted" style="margin:0">Waar gaan we vandaag over sparren?</p>
      </div>
      <span class="spacer"></span>
      <button class="primary" data-action="toggle-new-board">${S.ui.newBoard ? 'Annuleren' : '+ Nieuwe sessie'}</button>
    </div>

    ${S.ui.newBoard ? renderNewBoard() : ''}

    <section class="section">
      <div class="section-head">
        <h2>${S.ui.showArchived ? 'Gearchiveerde sessies' : 'Sessies'}</h2>
        <button class="ghost sm" data-action="toggle-archived">${S.ui.showArchived ? '← Actieve sessies' : 'Toon archief'}</button>
      </div>
      ${
        boards.length
          ? `<div class="board-grid">${boards
              .map(
                (b) => `
            <a class="panel board-card" href="#/b/${b.id}">
              <div class="row"><span class="badge accent">${esc(phaseLabel(b.phase))}</span><span class="spacer"></span>${avatar(b.createdBy, { size: 'sm' })}</div>
              <h3>${esc(b.title)}</h3>
              <div class="q">${esc(b.question || 'Geen centrale vraag')}</div>
              <div class="row muted small">
                <span>💡 ${b.ideaCount} ideeën</span>
                ${b.openActions ? `<span>✅ ${b.openActions} open acties</span>` : ''}
                <span class="spacer"></span><span>${relTime(b.updatedAt)}</span>
              </div>
            </a>`,
              )
              .join('')}</div>`
          : `<div class="panel empty-state">${
              S.ui.showArchived ? 'Geen gearchiveerde sessies.' : 'Nog geen sessies. Start er een met <strong>+ Nieuwe sessie</strong> — bijvoorbeeld “Horizon verbreden”.'
            }</div>`
      }
    </section>

    ${renderRadar()}
    ${renderTeam()}
  </main>`;
}

function renderNewBoard() {
  const tpl = S.config.templates.find((t) => t.key === S.ui.template);
  return `
  <section class="panel section">
    <h2>Nieuwe sessie</h2>
    <p class="muted small">Kies een werkvorm. Je kunt titel, vraag en thema's daarna altijd aanpassen.</p>
    <div class="template-grid">
      ${S.config.templates
        .map(
          (t) => `<button class="template ${t.key === S.ui.template ? 'selected' : ''}" data-action="pick-template" data-key="${t.key}">
            <strong>${esc(t.title)}</strong><span class="muted small">${esc(t.description || 'Leeg bord, eigen vraag.')}</span>
          </button>`,
        )
        .join('')}
    </div>
    <div class="stack">
      <div><label>Titel</label><input data-draft="nb.title" value="${attr(draft('nb.title'))}" placeholder="${attr(tpl.title)}"></div>
      <div><label>Centrale vraag</label><input data-draft="nb.question" value="${attr(draft('nb.question'))}" placeholder="${attr(tpl.question || 'Bijv. Hoe kunnen wij …?')}"></div>
      <div class="muted small">Thema's: ${tpl.clusters.map((c) => `<span class="badge">${esc(c)}</span>`).join(' ')}</div>
      <div><button class="primary" data-action="create-board">Sessie starten</button></div>
    </div>
  </section>`;
}

function renderRadar() {
  const opps = S.global.opportunities;
  return `
  <section class="section">
    <div class="section-head">
      <h2>🧭 Kansenradar</h2>
      <span class="muted small">De beste ideeën uit alle sessies, van verkennen tot bouwen.</span>
    </div>
    <div class="row" style="margin-bottom:0.75rem; max-width:640px">
      <input data-draft="opp.title" data-enter="add-opportunity" value="${attr(draft('opp.title'))}" placeholder="Nieuwe kans toevoegen…" style="flex:1">
      <button data-action="add-opportunity">Toevoegen</button>
    </div>
    <div class="kanban">
      ${S.config.stages
        .map((stage) => {
          const list = opps.filter((o) => o.stage === stage.key);
          return `<div class="kanban-col">
            <h3><span>${esc(stage.label)}</span><span class="muted">${list.length}</span></h3>
            ${list
              .map(
                (o) => `<div class="opp">
                  <div class="opp-title">${esc(o.title)}</div>
                  ${o.description ? `<div class="muted small" style="margin-bottom:0.35rem">${esc(o.description.slice(0, 160))}${o.description.length > 160 ? '…' : ''}</div>` : ''}
                  ${o.source ? `<div class="small" style="margin-bottom:0.35rem">uit <a href="#/b/${o.source.boardId}">${esc(o.source.boardTitle)}</a></div>` : ''}
                  <div class="row">
                    <select data-change="opp-owner" data-id="${o.id}" title="Trekker">
                      ${members().map((m) => `<option value="${m.id}" ${m.id === o.ownerId ? 'selected' : ''}>${esc(firstName(m.id))}</option>`).join('')}
                    </select>
                    <select data-change="opp-stage" data-id="${o.id}" title="Fase">
                      ${S.config.stages.map((s) => `<option value="${s.key}" ${s.key === o.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
                    </select>
                    <span class="spacer"></span>
                    <button class="ghost icon danger" data-action="remove-opportunity" data-id="${o.id}" title="Verwijderen">✕</button>
                  </div>
                </div>`,
              )
              .join('')}
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

function renderTeam() {
  const online = new Set(S.global.online);
  return `
  <section class="section">
    <div class="section-head"><h2>Het team</h2><span class="muted small">Vier perspectieven, één gesprek.</span></div>
    <div class="team-grid">
      ${members()
        .map((m) => {
          const r = roles()[m.role];
          return `<div class="panel team-card" style="--c:${r.color}">
            <div class="row">${avatar(m.id, { online: online.has(m.id) })}
              <div style="min-width:0; flex:1"><strong>${esc(m.name)}</strong><div class="muted small">${esc(r.label)}</div></div>
              <button class="ghost sm" data-action="rename-member" data-id="${m.id}" title="Naam wijzigen">✎</button>
            </div>
            <div class="small" style="margin-top:0.5rem"><strong>Bril:</strong> ${esc(r.lens)}</div>
            <ul>${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          </div>`;
        })
        .join('')}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Sessiebord
// ---------------------------------------------------------------------------
const TABS = [
  ['ideeen', '💡 Ideeën'],
  ['perspectieven', '👓 Perspectieven'],
  ['matrix', '📊 Prioriteren'],
  ['acties', '✅ Besluiten & acties'],
  ['ai', '✨ AI-sparringpartner'],
];

function renderBoard() {
  const b = S.board;
  if (!b) return '<div class="loading">Sessie laden…</div>';
  const tab = S.route.tab;
  const phaseIdx = S.config.phases.findIndex((p) => p.key === b.phase);
  return `
  <main class="page">
    <div class="board-head">
      <div style="flex:1; min-width:280px">
        <div class="small"><a href="#/">← Alle sessies</a></div>
        ${
          S.ui.editHeader
            ? `<div class="stack panel" style="margin-top:0.5rem">
                <div><label>Titel</label><input data-change="board-field" data-field="title" value="${attr(b.title)}"></div>
                <div><label>Centrale vraag</label><input data-change="board-field" data-field="question" value="${attr(b.question)}"></div>
                <div><label>Context</label><textarea data-change="board-field" data-field="description" rows="3">${esc(b.description)}</textarea></div>
                <div class="row">
                  <button class="primary sm" data-action="toggle-edit-header">Klaar</button>
                  <span class="spacer"></span>
                  <button class="sm" data-action="archive-board">${b.archived ? 'Uit archief halen' : 'Archiveren'}</button>
                  <button class="sm danger" data-action="delete-board">Verwijderen</button>
                </div>
              </div>`
            : `<h1>${esc(b.title)} <button class="ghost icon sm" data-action="toggle-edit-header" title="Bewerken">✎</button></h1>
               ${b.question ? `<div class="question">${esc(b.question)}</div>` : ''}
               ${b.description ? `<p class="muted small" style="margin-top:0.3rem; max-width:80ch">${esc(b.description)}</p>` : ''}`
        }
      </div>
      <div class="stack" style="align-items:flex-end">
        <div class="row">
          <span class="muted small">Hier nu:</span>
          <div class="avatars">${S.presence.map((id) => avatar(id, { size: 'sm', online: true })).join('') || '<span class="muted small">—</span>'}</div>
        </div>
        <div class="row">
          ${
            b.timer
              ? `<span class="timer" id="timer" data-ends="${b.timer.endsAt}">--:--</span><button class="sm ghost" data-action="timer" data-min="0">Stop</button>`
              : `<span class="muted small">⏱ Timebox:</span>${[5, 10, 15, 25].map((m) => `<button class="sm" data-action="timer" data-min="${m}">${m}m</button>`).join('')}`
          }
        </div>
        <a class="btn sm" href="/api/boards/${b.id}/export.md">⬇ Exporteer (Markdown)</a>
      </div>
    </div>

    <div class="phases">
      ${S.config.phases
        .map(
          (p, i) =>
            `<button class="phase ${i === phaseIdx ? 'current' : i < phaseIdx ? 'done' : ''}" data-action="phase" data-key="${p.key}"><span class="n">${i + 1}</span> ${esc(p.label)}</button>`,
        )
        .join('')}
    </div>
    <div class="muted small">${esc(S.config.phases[phaseIdx]?.hint ?? '')}</div>

    <nav class="tabs">
      ${TABS.map(([k, label]) => `<button class="tab ${tab === k ? 'active' : ''}" data-action="tab" data-key="${k}">${label}</button>`).join('')}
    </nav>

    ${S.aiBusy ? `<div class="ai-busy"><span class="spinner"></span> De AI denkt na${S.aiBusy.by ? ` (op verzoek van ${esc(firstName(S.aiBusy.by))})` : ''}…</div>` : ''}

    ${
      {
        ideeen: renderIdeas,
        perspectieven: renderPerspectives,
        matrix: renderMatrix,
        acties: renderActions,
        ai: renderAi,
      }[tab]?.() ?? renderIdeas()
    }
  </main>
  ${S.ui.openIdea ? renderDrawer() : ''}`;
}

function sortedIdeas(list) {
  return [...list].sort((a, b) => sum(b.votes) - sum(a.votes) || a.createdAt.localeCompare(b.createdAt));
}

function ideaCard(idea) {
  const myVotes = idea.votes[S.me] || 0;
  const color = idea.lens ? roles()[idea.lens].color : 'var(--border)';
  return `
  <article class="card ${idea.status}" style="--c:${color}" data-action="open-idea" data-id="${idea.id}">
    <div class="row" style="gap:0.35rem">${lensTag(idea.lens)}${idea.status === 'shortlist' ? '<span class="tag" style="--c:var(--warn)">⭐ shortlist</span>' : ''}${
      idea.status === 'geparkeerd' ? '<span class="tag">geparkeerd</span>' : ''
    }</div>
    <p class="card-text">${esc(idea.text)}</p>
    <div class="card-foot">
      ${idea.fromAi ? '<span title="AI-suggestie">✨</span>' : avatar(idea.authorId, { size: 'sm' })}
      <span class="pdots" title="Perspectieven gegeven">${roleKeys()
        .map((k) => `<span class="pdot ${idea.perspectives[k] ? 'on' : ''}" style="--c:${roles()[k].color}"></span>`)
        .join('')}</span>
      ${idea.comments.length ? `<span>💬 ${idea.comments.length}</span>` : ''}
      <span class="votes">
        ${myVotes ? `<button class="ghost" data-action="vote" data-id="${idea.id}" data-delta="-1" title="Stem terugnemen">−</button>` : ''}
        <span class="count ${myVotes ? 'mine' : ''}" title="${myVotes ? `waarvan ${myVotes} van jou` : ''}">${sum(idea.votes)}</span>
        <button class="ghost" data-action="vote" data-id="${idea.id}" data-delta="1" title="Stem">▲</button>
      </span>
    </div>
  </article>`;
}

function renderIdeas() {
  const b = S.board;
  const votesUsed = b.ideas.reduce((s, i) => s + (i.votes[S.me] || 0), 0);
  const visible = b.ideas.filter(
    (i) => (S.ui.showParked || i.status !== 'geparkeerd') && (!S.ui.lensFilter || i.lens === S.ui.lensFilter),
  );
  const myRole = member(S.me).role;
  return `
  <div class="panel">
    <div class="composer">
      <textarea data-draft="idea.text" data-enter="add-idea" rows="2" placeholder="Nieuw idee… (Enter = toevoegen, Shift+Enter = nieuwe regel)">${esc(draft('idea.text'))}</textarea>
      <select data-draft="idea.cluster" title="Thema">
        ${b.clusters.map((c) => `<option value="${c.id}" ${draft('idea.cluster') === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select data-draft="idea.lens" title="Vanuit welk perspectief?">
        <option value="">Geen specifiek perspectief</option>
        ${roleKeys().map((k) => `<option value="${k}" ${draft('idea.lens', myRole) === k ? 'selected' : ''}>${esc(roles()[k].lens)}</option>`).join('')}
      </select>
      <button class="primary" data-action="add-idea">Toevoegen</button>
    </div>
  </div>

  <div class="row" style="margin:0.9rem 0">
    <button class="chip ${!S.ui.lensFilter ? 'active' : ''}" data-action="lens-filter" data-key="">Alle</button>
    ${roleKeys()
      .map((k) => `<button class="chip ${S.ui.lensFilter === k ? 'active' : ''}" data-action="lens-filter" data-key="${k}">${esc(roles()[k].short)} · ${esc(roles()[k].lens)}</button>`)
      .join('')}
    <label class="row small" style="margin:0 0 0 0.5rem; gap:0.3rem"><input type="checkbox" style="width:auto" data-change="toggle-parked" ${S.ui.showParked ? 'checked' : ''}> geparkeerd tonen</label>
    <span class="spacer"></span>
    <span class="muted small">Jouw stemmen: <strong>${votesUsed}/${S.config.maxVotes}</strong></span>
    <button class="sm" data-action="add-cluster">+ Thema</button>
  </div>

  ${renderAiStrip()}

  ${
    b.ideas.length
      ? `<div class="columns">
      ${b.clusters
        .map((c) => {
          const ideas = sortedIdeas(visible.filter((i) => i.clusterId === c.id));
          return `<section class="column">
            <div class="column-head">
              <h3>${esc(c.name)} <span class="muted">${ideas.length}</span></h3>
              <button class="ghost icon sm" data-action="rename-cluster" data-id="${c.id}" title="Hernoemen">✎</button>
              <button class="ghost icon sm" data-action="remove-cluster" data-id="${c.id}" title="Verwijderen">✕</button>
            </div>
            ${ideas.map(ideaCard).join('') || '<div class="muted small" style="padding:0.4rem">Nog leeg</div>'}
          </section>`;
        })
        .join('')}
    </div>`
      : `<div class="panel empty-state">
        <p><strong>Nog geen ideeën.</strong></p>
        <p>Tip: zet een timebox van 10 minuten en schrijf ieder zoveel mogelijk ideeën op — nog zonder te oordelen.</p>
      </div>`
  }`;
}

function renderAiStrip() {
  if (!S.config.aiEnabled) return '';
  const b = S.board;
  const suggestions = b.aiSuggestions ?? [];
  return `
  <div class="ai-strip">
    <div class="row">
      <strong>✨ Laat de AI meedenken</strong>
      <span class="muted small">Ideeën vanuit alle vier de perspectieven, ook buiten de ServiceNow-wereld.</span>
      <span class="spacer"></span>
      <input data-draft="ai.focus" value="${attr(draft('ai.focus'))}" placeholder="Optioneel: focus (bijv. zorgsector, Microsoft, AI-agents)" style="max-width:360px">
      <button class="primary sm" data-action="ai-ideas" ${S.aiBusy ? 'disabled' : ''}>Genereer ideeën</button>
    </div>
    ${
      suggestions.length
        ? `<div class="suggestions">
        ${suggestions
          .map(
            (s) => `<div class="suggestion">
              <div class="row">${lensTag(s.lens)}<span class="spacer"></span><span class="badge">${esc(b.clusters.find((c) => c.id === s.clusterId)?.name ?? '')}</span></div>
              <p><strong>${esc(s.text)}</strong></p>
              <p class="muted small">${esc(s.details)}</p>
              <div class="row"><button class="sm primary" data-action="accept-suggestion" data-id="${s.id}">Op het bord</button><button class="sm ghost" data-action="dismiss-suggestion" data-id="${s.id}">Negeren</button></div>
            </div>`,
          )
          .join('')}
      </div>`
        : ''
    }
  </div>`;
}

function renderPerspectives() {
  const b = S.board;
  let ideas = b.ideas.filter((i) => i.status === 'shortlist');
  const usingShortlist = ideas.length > 0;
  if (!usingShortlist) ideas = sortedIdeas(b.ideas.filter((i) => i.status !== 'geparkeerd')).slice(0, 8);
  const myRole = member(S.me).role;
  return `
  <div class="lens-grid">
    ${roleKeys()
      .map((k) => {
        const r = roles()[k];
        const m = members().find((x) => x.role === k);
        return `<div class="panel lens-card" style="--c:${r.color}">
          <div class="row">${avatar(m.id, { size: 'sm' })}<strong>${esc(r.lens)}</strong></div>
          <ul>${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
        </div>`;
      })
      .join('')}
  </div>
  <p class="muted small">${
    usingShortlist
      ? `De ${ideas.length} ideeën op de shortlist. Klik op een vakje om je perspectief te geven of te lezen.`
      : 'Nog geen shortlist — hieronder de ideeën met de meeste stemmen. Zet ideeën op de ⭐ shortlist om gericht te bespreken.'
  }</p>
  ${
    ideas.length
      ? `<div class="panel" style="overflow-x:auto">
    <table class="ptable">
      <thead><tr><th class="idea-col">Idee</th>${roleKeys()
        .map((k) => `<th style="color:${roles()[k].color}">${esc(roles()[k].label)}</th>`)
        .join('')}</tr></thead>
      <tbody>
      ${ideas
        .map((idea) => {
          const counts = { kans: 0, zorg: 0 };
          for (const p of Object.values(idea.perspectives)) counts[p.sentiment] = (counts[p.sentiment] ?? 0) + 1;
          return `<tr>
            <td><div class="pcell" style="background:var(--surface-2); color:var(--text)" data-action="open-idea" data-id="${idea.id}">
              <strong>${esc(idea.text)}</strong><br><span class="muted small">▲ ${sum(idea.votes)} · <span class="sentiment-kans">${counts.kans} kans</span> · <span class="sentiment-zorg">${counts.zorg} zorg</span></span>
            </div></td>
            ${roleKeys()
              .map((k) => {
                const p = idea.perspectives[k];
                const mine = k === myRole;
                return `<td><div class="pcell ${p ? p.sentiment : 'empty'} ${mine ? 'mine' : ''}" data-action="open-idea" data-id="${idea.id}">${
                  p ? esc(p.text) : mine ? '+ Jouw perspectief' : 'Nog niet ingevuld'
                }</div></td>`;
              })
              .join('')}
          </tr>`;
        })
        .join('')}
      </tbody>
    </table></div>`
      : '<div class="panel empty-state">Voeg eerst ideeën toe op het tabblad Ideeën.</div>'
  }`;
}

function ratingStats(idea) {
  const r = Object.values(idea.ratings);
  return { impact: avg(r.map((x) => x.impact)), effort: avg(r.map((x) => x.effort)), n: r.length };
}

function scale(ideaId, field, value) {
  return `<span class="scale">${[1, 2, 3, 4, 5]
    .map((n) => `<button class="${value === n ? 'on' : ''}" data-action="rate" data-id="${ideaId}" data-field="${field}" data-value="${value === n ? '' : n}" title="${value === n ? 'Klik om te wissen' : ''}">${n}</button>`)
    .join('')}</span>`;
}

function renderMatrix() {
  const ideas = sortedIdeas(S.board.ideas.filter((i) => i.status !== 'geparkeerd'));
  const numbered = ideas.map((idea, i) => ({ idea, num: i + 1, ...ratingStats(idea) }));
  const rated = numbered.filter((x) => x.impact != null && x.effort != null);
  const mine = ideas.filter((i) => i.ratings[S.me]).length;
  const score = (x) => x.impact - x.effort * 0.5;
  const ranking = [...rated].sort((a, b) => score(b) - score(a));
  return `
  <div class="matrix-wrap">
    <div>
      <div class="panel">
        <h3>Impact × inspanning</h3>
        <p class="muted small">Gemiddelde van alle scores. Linksboven zitten de quick wins.</p>
        <div class="matrix">
          <div class="quad">🚀 Quick wins</div>
          <div class="quad">🏔 Grote projecten</div>
          <div class="quad">🧩 Opvullers</div>
          <div class="quad">🕳 Tijdvreters</div>
          ${rated
            .map((x) => {
              const left = ((x.effort - 1) / 4) * 92 + 4;
              const bottom = ((x.impact - 1) / 4) * 92 + 4;
              const color = x.idea.lens ? roles()[x.idea.lens].color : 'var(--accent)';
              return `<span class="dot" style="left:${left}%; bottom:${bottom}%; --c:${color}" data-action="open-idea" data-id="${x.idea.id}" title="${attr(
                `${x.idea.text}\nimpact ${x.impact.toFixed(1)} · inspanning ${x.effort.toFixed(1)} · ${x.n} scores`,
              )}">${x.num}</span>`;
            })
            .join('')}
        </div>
        <div class="axis"><span>← weinig inspanning</span><span>veel inspanning →</span></div>
      </div>
      ${
        ranking.length
          ? `<div class="panel" style="margin-top:1rem">
        <h3>Ranglijst</h3>
        <p class="muted small">Gesorteerd op impact min de helft van de inspanning.</p>
        <table class="list">
          <thead><tr><th>#</th><th>Idee</th><th>▲</th><th>Impact</th><th>Inspanning</th><th>Partners</th></tr></thead>
          <tbody>${ranking
            .map(
              (x) => `<tr><td><span class="num">${x.num}</span></td>
                <td><a href="#" data-action="open-idea" data-id="${x.idea.id}">${esc(x.idea.text)}</a></td>
                <td>${sum(x.idea.votes)}</td><td>${x.impact.toFixed(1)}</td><td>${x.effort.toFixed(1)}</td><td>${x.n}/4</td></tr>`,
            )
            .join('')}</tbody>
        </table></div>`
          : ''
      }
    </div>
    <div class="panel">
      <h3>Jouw scores</h3>
      <p class="muted small">Je hebt ${mine} van de ${ideas.length} ideeën gescoord. Impact: hoeveel waarde levert het op? Inspanning: hoeveel tijd, geld en mensen kost het?</p>
      ${numbered
        .map(({ idea, num }) => {
          const r = idea.ratings[S.me] ?? {};
          return `<div class="rate-row">
            <span class="num">${num}</span>
            <span class="small">${esc(idea.text)}</span>
            <span class="scales">
              <span>impact ${scale(idea.id, 'impact', r.impact)}</span>
              <span>inspanning ${scale(idea.id, 'effort', r.effort)}</span>
            </span>
          </div>`;
        })
        .join('') || '<div class="empty-state">Nog geen ideeën om te scoren.</div>'}
    </div>
  </div>`;
}

function renderActions() {
  const b = S.board;
  return `
  <div class="grid-2">
    <div class="stack">
      <div class="panel">
        <h3>Besluiten</h3>
        ${b.decisions.length ? '' : '<p class="muted small">Wat hebben we samen besloten?</p>'}
        <ul style="padding-left:1.1rem">
          ${b.decisions
            .map((d) => `<li style="margin-bottom:0.3rem">${esc(d.text)} <span class="muted small">— ${esc(firstName(d.authorId))}</span> <button class="ghost icon sm" data-action="remove-decision" data-id="${d.id}">✕</button></li>`)
            .join('')}
        </ul>
        <div class="row"><input data-draft="decision.text" data-enter="add-decision" value="${attr(draft('decision.text'))}" placeholder="Nieuw besluit…" style="flex:1"><button data-action="add-decision">Toevoegen</button></div>
      </div>
      <div class="panel">
        <h3>Acties</h3>
        <table class="list">
          <tbody>
          ${b.actions
            .map(
              (a) => `<tr class="${a.done ? 'done' : ''}">
                <td style="width:1.5rem"><input type="checkbox" style="width:auto" data-change="toggle-action" data-id="${a.id}" ${a.done ? 'checked' : ''}></td>
                <td class="text">${esc(a.text)}</td>
                <td>${avatar(a.ownerId, { size: 'sm' })}</td>
                <td class="muted small">${a.due ? new Date(a.due).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : ''}</td>
                <td><button class="ghost icon sm" data-action="remove-action" data-id="${a.id}">✕</button></td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>
        <div class="row" style="margin-top:0.6rem">
          <input data-draft="action.text" data-enter="add-action" value="${attr(draft('action.text'))}" placeholder="Wat moet er gebeuren?" style="flex:2; min-width:180px">
          <select data-draft="action.owner" style="flex:1; min-width:110px">
            ${members().map((m) => `<option value="${m.id}" ${draft('action.owner', S.me) === m.id ? 'selected' : ''}>${esc(firstName(m.id))}</option>`).join('')}
          </select>
          <input type="date" data-draft="action.due" value="${attr(draft('action.due'))}" style="flex:1; min-width:140px">
          <button data-action="add-action">Toevoegen</button>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3>Sessienotities</h3>
      <p class="muted small">Gedeeld kladblok. Wordt opgeslagen zodra je buiten het veld klikt.</p>
      <textarea data-change="board-notes" rows="18" placeholder="Aantekeningen, links, inzichten…">${esc(b.notes)}</textarea>
    </div>
  </div>`;
}

const ASK_PROMPTS = [
  'Welke markten liggen dicht bij onze ServiceNow-ervaring maar zijn nog onontgonnen?',
  'Welk perspectief ontbreekt nog in deze discussie?',
  'Wat is het meest onderschatte idee op het bord, en waarom?',
  'Maak een 90-dagenplan voor het sterkste idee.',
];

function renderAi() {
  const b = S.board;
  if (!S.config.aiEnabled) {
    return `<div class="panel empty-state">
      <p><strong>De AI-sparringpartner staat uit.</strong></p>
      <p>Zet <code>ANTHROPIC_API_KEY</code> in de omgeving van de server en herstart om ideeën te laten genereren, ideeën kritisch te laten bevragen en sessies samen te vatten.</p>
    </div>`;
  }
  const thread = b.aiThread ?? [];
  return `
  <div class="grid-2">
    <div class="panel">
      <div class="row"><h3 style="margin:0">Vraag de sparringpartner</h3></div>
      <p class="muted small">De AI kent de vraag, alle ideeën, perspectieven en notities van deze sessie. Het gesprek is zichtbaar voor het hele team.</p>
      <div class="thread">
        ${thread
          .map(
            (t) => `<div class="q-bubble"><div class="small" style="opacity:0.8">${esc(firstName(t.by))}</div>${esc(t.question)}</div>
                    <div class="a-bubble">${md(t.answer)}</div>`,
          )
          .join('')}
      </div>
      <div class="row" style="margin-bottom:0.5rem">${ASK_PROMPTS.map((p) => `<button class="chip" data-action="ask-preset" data-q="${attr(p)}" ${S.aiBusy ? 'disabled' : ''}>${esc(p)}</button>`).join('')}</div>
      <div class="row">
        <textarea data-draft="ai.question" data-enter="ai-ask" rows="2" placeholder="Stel een vraag…" style="flex:1">${esc(draft('ai.question'))}</textarea>
        <button class="primary" data-action="ai-ask" ${S.aiBusy ? 'disabled' : ''}>Vraag</button>
      </div>
    </div>
    <div class="panel">
      <div class="row"><h3 style="margin:0">Samenvatting</h3><span class="spacer"></span>
        <button class="sm primary" data-action="ai-summary" ${S.aiBusy ? 'disabled' : ''}>${b.aiSummary ? 'Opnieuw samenvatten' : 'Vat de sessie samen'}</button>
      </div>
      ${
        b.aiSummary
          ? `<p class="muted small">Gemaakt ${relTime(b.aiSummary.createdAt)} op verzoek van ${esc(firstName(b.aiSummary.requestedBy))}.</p>${md(b.aiSummary.text)}`
          : '<p class="muted small" style="margin-top:0.6rem">Kern, sterkste ideeën, botsende perspectieven, open vragen en voorgestelde volgende stappen.</p>'
      }
    </div>
  </div>`;
}

// ---------- Idee-detail ----------
function renderDrawer() {
  const b = S.board;
  const idea = b.ideas.find((i) => i.id === S.ui.openIdea);
  if (!idea) return '';
  const myRole = member(S.me).role;
  const stats = ratingStats(idea);
  const mineR = idea.ratings[S.me] ?? {};
  const ch = idea.aiChallenge;
  return `
  <div class="drawer-backdrop" data-action="close-idea"></div>
  <aside class="drawer" role="dialog" aria-label="Idee">
    <div class="row">
      <div class="segmented">
        ${[
          ['open', 'Open'],
          ['shortlist', '⭐ Shortlist'],
          ['geparkeerd', 'Geparkeerd'],
        ]
          .map(([k, l]) => `<button class="${idea.status === k ? 'on' : ''}" data-action="idea-status" data-id="${idea.id}" data-status="${k}">${l}</button>`)
          .join('')}
      </div>
      <span class="spacer"></span>
      <button class="ghost" data-action="close-idea" title="Sluiten (Esc)">✕</button>
    </div>

    <div class="stack">
      <textarea class="title" rows="2" data-change="idea-field" data-id="${idea.id}" data-field="text">${esc(idea.text)}</textarea>
      <textarea rows="3" data-change="idea-field" data-id="${idea.id}" data-field="details" placeholder="Toelichting: wat houdt het in, voor wie, waarom nu?">${esc(idea.details)}</textarea>
      <div class="row">
        <select data-change="idea-field" data-id="${idea.id}" data-field="clusterId" style="flex:1">
          ${b.clusters.map((c) => `<option value="${c.id}" ${c.id === idea.clusterId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select data-change="idea-field" data-id="${idea.id}" data-field="lens" style="flex:1">
          <option value="">Geen specifiek perspectief</option>
          ${roleKeys().map((k) => `<option value="${k}" ${idea.lens === k ? 'selected' : ''}>${esc(roles()[k].lens)}</option>`).join('')}
        </select>
      </div>
      <div class="muted small">${idea.fromAi ? '✨ AI-suggestie, toegevoegd' : `Door ${esc(member(idea.authorId).name)}`} · ${relTime(idea.createdAt)} · ▲ ${sum(idea.votes)} ${sum(idea.votes) === 1 ? 'stem' : 'stemmen'}</div>
    </div>

    <section>
      <h4>Perspectieven</h4>
      <div class="stack">
        ${roleKeys()
          .map((k) => {
            const r = roles()[k];
            const p = idea.perspectives[k];
            const m = members().find((x) => x.role === k);
            if (k === myRole) {
              const sentiment = p?.sentiment ?? 'neutraal';
              return `<div class="persp ${sentiment}" style="--c:${r.color}">
                <div class="persp-head">${avatar(m.id, { size: 'sm' })} Jouw blik als ${esc(r.label)}</div>
                <textarea rows="3" id="my-perspective" data-change="perspective" data-id="${idea.id}" placeholder="${attr(r.questions.join(' '))}">${esc(p?.text ?? '')}</textarea>
                <div class="row" style="margin-top:0.4rem">
                  <span class="muted small">Mijn oordeel:</span>
                  <div class="segmented">
                    ${['kans', 'neutraal', 'zorg']
                      .map((s) => `<button class="${sentiment === s ? 'on' : ''}" data-action="sentiment" data-id="${idea.id}" data-sentiment="${s}">${{ kans: '👍 Kans', neutraal: 'Neutraal', zorg: '⚠️ Zorg' }[s]}</button>`)
                      .join('')}
                  </div>
                </div>
              </div>`;
            }
            return `<div class="persp ${p?.sentiment ?? ''}" style="--c:${r.color}">
              <div class="persp-head">${avatar(m.id, { size: 'sm' })} ${esc(m.name)} <span class="muted small">· ${esc(r.lens)}</span>
                ${p ? `<span class="spacer"></span><span class="small sentiment-${p.sentiment}">${{ kans: '👍 kans', neutraal: 'neutraal', zorg: '⚠️ zorg' }[p.sentiment]}</span>` : ''}
              </div>
              ${p ? `<div style="white-space:pre-wrap">${esc(p.text)}</div>` : '<div class="muted small">Nog geen perspectief gegeven.</div>'}
            </div>`;
          })
          .join('')}
      </div>
    </section>

    <section>
      <h4>Scoren</h4>
      <div class="stack">
        <div class="row">Impact ${scale(idea.id, 'impact', mineR.impact)}</div>
        <div class="row">Inspanning ${scale(idea.id, 'effort', mineR.effort)}</div>
        <div class="muted small">${
          stats.n ? `Gemiddeld (${stats.n} van 4 partners): impact ${stats.impact?.toFixed(1) ?? "–"} · inspanning ${stats.effort?.toFixed(1) ?? "–"}` : 'Nog niemand heeft gescoord.'
        }</div>
      </div>
    </section>

    ${
      S.config.aiEnabled
        ? `<section>
      <h4>Advocaat van de duivel</h4>
      ${
        ch
          ? `<div class="challenge">
              ${roleKeys().map((k) => `<p><strong style="color:${roles()[k].color}">${esc(roles()[k].label)}:</strong> ${esc(ch.perspectives[k])}</p>`).join('')}
              <strong>Risico's</strong><ul>${ch.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
              <strong>Aannames om te toetsen</strong><ul>${ch.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
              <strong>Kleinste experiment</strong><p>${esc(ch.experiment)}</p>
              <span class="muted small">${relTime(ch.createdAt)} · op verzoek van ${esc(firstName(ch.requestedBy))}</span>
            </div>`
          : '<p class="muted small">Laat de AI dit idee kritisch bevragen vanuit alle vier de rollen, met risico\'s, aannames en een klein experiment.</p>'
      }
      <button class="sm" data-action="ai-challenge" data-id="${idea.id}" ${S.aiBusy ? 'disabled' : ''} style="margin-top:0.5rem">✨ ${ch ? 'Opnieuw bevragen' : 'Bevraag dit idee'}</button>
    </section>`
        : ''
    }

    <section>
      <h4>Opmerkingen</h4>
      ${idea.comments
        .map(
          (c) => `<div class="comment">${avatar(c.authorId, { size: 'sm' })}<div class="body"><div class="small"><strong>${esc(firstName(c.authorId))}</strong> <span class="muted">${relTime(
            c.createdAt,
          )}</span></div>${esc(c.text)}</div></div>`,
        )
        .join('')}
      <div class="row">
        <input data-draft="comment.${idea.id}" data-enter="add-comment" data-id="${idea.id}" value="${attr(draft(`comment.${idea.id}`))}" placeholder="Reageer…" style="flex:1">
        <button data-action="add-comment" data-id="${idea.id}">Plaats</button>
      </div>
    </section>

    <div class="row">
      <button data-action="to-radar" data-id="${idea.id}">🧭 Naar kansenradar</button>
      <span class="spacer"></span>
      <button class="danger" data-action="remove-idea" data-id="${idea.id}">Verwijderen</button>
    </div>
  </aside>`;
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
let timerInterval = null;
let lastTimerEnd = null;
function tickTimer() {
  const el = document.getElementById('timer');
  if (!el) {
    clearInterval(timerInterval);
    timerInterval = null;
    return;
  }
  const update = () => {
    const t = document.getElementById('timer');
    if (!t) return;
    const left = Math.max(0, new Date(t.dataset.ends).getTime() - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    t.textContent = left ? `${m}:${String(s).padStart(2, '0')}` : 'Tijd!';
    t.classList.toggle('ending', left < 60_000);
    if (!left && lastTimerEnd !== t.dataset.ends) {
      lastTimerEnd = t.dataset.ends;
      toast('⏰ De tijd is om!');
    }
  };
  update();
  timerInterval ??= setInterval(update, 1000);
}

// ---------------------------------------------------------------------------
// Acties
// ---------------------------------------------------------------------------
async function runAi(kind, body, successMsg) {
  try {
    await api('POST', `/api/boards/${S.board.id}/ai/${kind}`, body);
    if (successMsg) toast(successMsg);
  } catch (err) {
    toastError(err);
  }
}

const clearDraft = (...keys) => {
  for (const k of keys) {
    delete S.drafts[k];
    // Een veld met focus wordt niet door render() bijgewerkt; leeg het hier.
    for (const el of root.querySelectorAll(`[data-draft="${CSS.escape(k)}"]`)) el.value = '';
  }
  render();
};

const actions = {
  async login(el) {
    try {
      await api('POST', '/api/login', { code: draft('login.code'), memberId: el.dataset.id });
      S.me = el.dataset.id;
      delete S.drafts['login.code'];
      const state = await api('GET', '/api/state');
      S.global = state;
      connect();
      render();
    } catch (err) {
      toastError(err);
    }
  },
  async logout() {
    await api('POST', '/api/logout').catch(() => {});
    S.me = null;
    ws?.close();
    render();
  },
  'toggle-new-board'() {
    S.ui.newBoard = !S.ui.newBoard;
    render();
  },
  'toggle-archived'() {
    S.ui.showArchived = !S.ui.showArchived;
    render();
  },
  'pick-template'(el) {
    S.ui.template = el.dataset.key;
    render();
  },
  async 'create-board'() {
    try {
      const board = await api('POST', '/api/boards', {
        template: S.ui.template,
        title: draft('nb.title'),
        question: draft('nb.question'),
      });
      S.ui.newBoard = false;
      delete S.drafts['nb.title'];
      delete S.drafts['nb.question'];
      go(`#/b/${board.id}`);
    } catch (err) {
      toastError(err);
    }
  },
  async 'rename-member'(el) {
    const name = prompt('Nieuwe naam:', member(el.dataset.id).name);
    if (name != null) await api('POST', `/api/members/${el.dataset.id}/name`, { name }).catch(toastError);
  },
  'add-opportunity'() {
    const title = draft('opp.title').trim();
    if (!title) return;
    act('opportunity.add', { title });
    clearDraft('opp.title');
  },
  'remove-opportunity'(el) {
    if (confirm('Deze kans verwijderen?')) act('opportunity.remove', { id: el.dataset.id });
  },

  // Bord
  tab(el) {
    go(`#/b/${S.board.id}/${el.dataset.key}`);
  },
  phase(el) {
    act('board.phase', { phase: el.dataset.key });
  },
  timer(el) {
    act('board.timer', { minutes: Number(el.dataset.min) });
  },
  'toggle-edit-header'() {
    S.ui.editHeader = !S.ui.editHeader;
    render();
  },
  'archive-board'() {
    act('board.archive', { archived: !S.board.archived });
  },
  async 'delete-board'() {
    if (!confirm(`Sessie “${S.board.title}” definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    try {
      await api('DELETE', `/api/boards/${S.board.id}`);
      go('#/');
    } catch (err) {
      toastError(err);
    }
  },
  'lens-filter'(el) {
    S.ui.lensFilter = el.dataset.key || null;
    render();
  },
  'add-idea'() {
    const text = draft('idea.text').trim();
    if (!text) return;
    act('idea.add', {
      text,
      clusterId: draft('idea.cluster', S.board.clusters[0]?.id),
      lens: draft('idea.lens', member(S.me).role),
    });
    clearDraft('idea.text');
  },
  'add-cluster'() {
    const name = prompt('Naam van het nieuwe thema:');
    if (name?.trim()) act('cluster.add', { name });
  },
  'rename-cluster'(el) {
    const c = S.board.clusters.find((x) => x.id === el.dataset.id);
    const name = prompt('Nieuwe naam:', c?.name);
    if (name?.trim()) act('cluster.rename', { id: el.dataset.id, name });
  },
  'remove-cluster'(el) {
    if (confirm('Thema verwijderen? De ideeën verhuizen naar het eerste thema.')) act('cluster.remove', { id: el.dataset.id });
  },
  vote(el) {
    act('idea.vote', { id: el.dataset.id, delta: Number(el.dataset.delta) });
  },
  'open-idea'(el, e) {
    e.preventDefault();
    S.ui.openIdea = el.dataset.id;
    render();
  },
  'close-idea'() {
    S.ui.openIdea = null;
    render();
  },
  'idea-status'(el) {
    act('idea.status', { id: el.dataset.id, status: el.dataset.status });
  },
  sentiment(el) {
    const text = document.getElementById('my-perspective')?.value.trim();
    if (!text) return toast('Schrijf eerst je perspectief op.');
    act('idea.perspective', { id: el.dataset.id, text, sentiment: el.dataset.sentiment });
  },
  rate(el) {
    act('idea.rate', { id: el.dataset.id, [el.dataset.field]: el.dataset.value ? Number(el.dataset.value) : null });
  },
  'add-comment'(el) {
    const key = `comment.${el.dataset.id}`;
    const text = draft(key).trim();
    if (!text) return;
    act('idea.comment', { id: el.dataset.id, text });
    clearDraft(key);
  },
  'remove-idea'(el) {
    if (!confirm('Dit idee verwijderen?')) return;
    S.ui.openIdea = null;
    act('idea.remove', { id: el.dataset.id });
  },
  async 'to-radar'(el) {
    await act('opportunity.add', { boardId: S.board.id, ideaId: el.dataset.id });
    toast('Toegevoegd aan de kansenradar 🧭');
  },
  'accept-suggestion'(el) {
    act('suggestion.accept', { id: el.dataset.id });
  },
  'dismiss-suggestion'(el) {
    act('suggestion.dismiss', { id: el.dataset.id });
  },
  'add-decision'() {
    const text = draft('decision.text').trim();
    if (!text) return;
    act('decision.add', { text });
    clearDraft('decision.text');
  },
  'remove-decision'(el) {
    act('decision.remove', { id: el.dataset.id });
  },
  'add-action'() {
    const text = draft('action.text').trim();
    if (!text) return;
    act('action.add', { text, ownerId: draft('action.owner', S.me), due: draft('action.due') });
    clearDraft('action.text', 'action.due');
  },
  'remove-action'(el) {
    act('action.remove', { id: el.dataset.id });
  },

  // AI
  'ai-ideas'() {
    runAi('ideas', { focus: draft('ai.focus') }, 'Nieuwe AI-suggesties staan klaar ✨');
  },
  'ai-challenge'(el) {
    runAi('challenge', { ideaId: el.dataset.id });
  },
  'ai-summary'() {
    runAi('summary', {});
  },
  'ai-ask'() {
    const question = draft('ai.question').trim();
    if (!question) return;
    clearDraft('ai.question');
    runAi('ask', { question });
  },
  'ask-preset'(el) {
    runAi('ask', { question: el.dataset.q });
  },
};

const changeHandlers = {
  'board-field'(el) {
    act('board.update', { [el.dataset.field]: el.value });
  },
  'board-notes'(el) {
    act('board.notes', { notes: el.value });
  },
  'idea-field'(el) {
    act('idea.update', { id: el.dataset.id, [el.dataset.field]: el.value });
  },
  perspective(el) {
    const idea = S.board.ideas.find((i) => i.id === el.dataset.id);
    const sentiment = idea?.perspectives[S.me]?.sentiment ?? 'neutraal';
    act('idea.perspective', { id: el.dataset.id, text: el.value, sentiment });
  },
  'toggle-parked'(el) {
    S.ui.showParked = el.checked;
    render();
  },
  'toggle-action'(el) {
    act('action.toggle', { id: el.dataset.id });
  },
  'opp-stage'(el) {
    act('opportunity.update', { id: el.dataset.id, stage: el.value });
  },
  'opp-owner'(el) {
    act('opportunity.update', { id: el.dataset.id, ownerId: el.value });
  },
};

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  if (el.tagName === 'A' && el.getAttribute('href') !== '#') return;
  actions[el.dataset.action]?.(el, e);
});

root.addEventListener('input', (e) => {
  const key = e.target.dataset?.draft;
  if (key) S.drafts[key] = e.target.value;
});

root.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.draft) {
    S.drafts[el.dataset.draft] = el.value;
    return;
  }
  if (el.dataset.change) changeHandlers[el.dataset.change]?.(el);
});

root.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key === 'Enter' && !e.shiftKey && el.dataset?.enter) {
    e.preventDefault();
    S.drafts[el.dataset.draft] = el.value;
    actions[el.dataset.enter]?.(el, e);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.ui.openIdea) {
    document.activeElement?.blur();
    S.ui.openIdea = null;
    render();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async function init() {
  S.route = parseRoute();
  try {
    S.config = await api('GET', '/api/config');
    S.me = S.config.me;
    if (S.me) {
      S.global = await api('GET', '/api/state');
      connect();
    }
  } catch (err) {
    toastError(err);
  }
  render();
  setInterval(() => S.me && render(), 60_000); // relatieve tijden bijwerken
})();
