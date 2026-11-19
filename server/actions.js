// Alle wijzigingen lopen via deze acties. De server past ze toe, slaat op en
// stuurt de nieuwe toestand naar iedereen die meekijkt.
import { randomUUID } from 'node:crypto';
import { MAX_VOTES_PER_MEMBER, OPPORTUNITY_STAGES, PHASES, ROLE_KEYS, TEMPLATES } from './config.js';

export class ActionError extends Error {}

const id = () => randomUUID().slice(0, 8);
const now = () => new Date().toISOString();

function text(value, max = 2000, { required = false } = {}) {
  const v = typeof value === 'string' ? value.trim().slice(0, max) : '';
  if (required && !v) throw new ActionError('Tekst mag niet leeg zijn.');
  return v;
}

function findIdea(board, ideaId) {
  const idea = board.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new ActionError('Idee niet gevonden.');
  return idea;
}

function clusterOrDefault(board, clusterId) {
  if (board.clusters.some((c) => c.id === clusterId)) return clusterId;
  return board.clusters[0]?.id ?? null;
}

export function createBoard(state, { title, question, description, template }, memberId) {
  const tpl = TEMPLATES.find((t) => t.key === template) ?? TEMPLATES.at(-1);
  const board = {
    id: id(),
    title: text(title, 120) || tpl.title,
    question: text(question, 500) || tpl.question,
    description: text(description, 2000) || tpl.description,
    template: tpl.key,
    phase: 'verkennen',
    createdAt: now(),
    createdBy: memberId,
    updatedAt: now(),
    archived: false,
    timer: null,
    notes: '',
    clusters: tpl.clusters.map((name) => ({ id: id(), name })),
    ideas: [],
    decisions: [],
    actions: [],
    aiSuggestions: [],
  };
  state.boards[board.id] = board;
  return board;
}

function newIdea(board, { text: t, details, clusterId, lens }, author) {
  return {
    id: id(),
    text: text(t, 280, { required: true }),
    details: text(details, 2000),
    clusterId: clusterOrDefault(board, clusterId),
    lens: ROLE_KEYS.includes(lens) ? lens : null,
    authorId: author,
    createdAt: now(),
    status: 'open',
    votes: {},
    ratings: {},
    perspectives: {},
    comments: [],
  };
}

const boardHandlers = {
  'board.update'(board, p) {
    if ('title' in p) board.title = text(p.title, 120, { required: true });
    if ('question' in p) board.question = text(p.question, 500);
    if ('description' in p) board.description = text(p.description, 2000);
  },
  'board.archive'(board, p) {
    board.archived = Boolean(p.archived);
  },
  'board.phase'(board, p) {
    if (!PHASES.some((ph) => ph.key === p.phase)) throw new ActionError('Onbekende fase.');
    board.phase = p.phase;
  },
  'board.timer'(board, p) {
    const minutes = Number(p.minutes);
    board.timer =
      minutes > 0 && minutes <= 120
        ? { endsAt: new Date(Date.now() + minutes * 60_000).toISOString(), minutes }
        : null;
  },
  'board.notes'(board, p) {
    board.notes = text(p.notes, 20_000);
  },

  'cluster.add'(board, p) {
    board.clusters.push({ id: id(), name: text(p.name, 60, { required: true }) });
  },
  'cluster.rename'(board, p) {
    const c = board.clusters.find((x) => x.id === p.id);
    if (!c) throw new ActionError('Thema niet gevonden.');
    c.name = text(p.name, 60, { required: true });
  },
  'cluster.remove'(board, p) {
    if (board.clusters.length <= 1) throw new ActionError('Er moet minstens één thema blijven.');
    board.clusters = board.clusters.filter((c) => c.id !== p.id);
    const fallback = board.clusters[0].id;
    for (const idea of board.ideas) if (idea.clusterId === p.id) idea.clusterId = fallback;
  },

  'idea.add'(board, p, member) {
    const idea = newIdea(board, p, member);
    board.ideas.push(idea);
    return idea;
  },
  'idea.update'(board, p) {
    const idea = findIdea(board, p.id);
    if ('text' in p) idea.text = text(p.text, 280, { required: true });
    if ('details' in p) idea.details = text(p.details, 2000);
    if ('clusterId' in p) idea.clusterId = clusterOrDefault(board, p.clusterId);
    if ('lens' in p) idea.lens = ROLE_KEYS.includes(p.lens) ? p.lens : null;
  },
  'idea.remove'(board, p) {
    findIdea(board, p.id);
    board.ideas = board.ideas.filter((i) => i.id !== p.id);
  },
  'idea.status'(board, p) {
    if (!['open', 'shortlist', 'geparkeerd'].includes(p.status)) throw new ActionError('Onbekende status.');
    findIdea(board, p.id).status = p.status;
  },
  'idea.vote'(board, p, member) {
    const idea = findIdea(board, p.id);
    const delta = p.delta < 0 ? -1 : 1;
    const used = board.ideas.reduce((sum, i) => sum + (i.votes[member] || 0), 0);
    if (delta > 0 && used >= MAX_VOTES_PER_MEMBER) {
      throw new ActionError(`Je hebt al je ${MAX_VOTES_PER_MEMBER} stemmen gebruikt.`);
    }
    const next = Math.max(0, (idea.votes[member] || 0) + delta);
    if (next === 0) delete idea.votes[member];
    else idea.votes[member] = next;
  },
  'idea.rate'(board, p, member) {
    const idea = findIdea(board, p.id);
    const next = { ...idea.ratings[member] };
    for (const field of ['impact', 'effort']) {
      if (!(field in p)) continue;
      if (p[field] == null) delete next[field];
      else next[field] = Math.min(5, Math.max(1, Math.round(Number(p[field])) || 1));
    }
    if (Object.keys(next).length) idea.ratings[member] = next;
    else delete idea.ratings[member];
  },
  'idea.perspective'(board, p, member) {
    const idea = findIdea(board, p.id);
    const value = text(p.text, 2000);
    const sentiment = ['kans', 'neutraal', 'zorg'].includes(p.sentiment) ? p.sentiment : 'neutraal';
    if (value) idea.perspectives[member] = { text: value, sentiment, updatedAt: now() };
    else delete idea.perspectives[member];
  },
  'idea.comment'(board, p, member) {
    findIdea(board, p.id).comments.push({ id: id(), authorId: member, text: text(p.text, 1000, { required: true }), createdAt: now() });
  },

  'decision.add'(board, p, member) {
    board.decisions.push({ id: id(), text: text(p.text, 500, { required: true }), authorId: member, createdAt: now() });
  },
  'decision.remove'(board, p) {
    board.decisions = board.decisions.filter((d) => d.id !== p.id);
  },
  'action.add'(board, p, member) {
    board.actions.push({
      id: id(),
      text: text(p.text, 300, { required: true }),
      ownerId: ROLE_KEYS.includes(p.ownerId) ? p.ownerId : member,
      due: /^\d{4}-\d{2}-\d{2}$/.test(p.due ?? '') ? p.due : '',
      done: false,
      createdAt: now(),
    });
  },
  'action.toggle'(board, p) {
    const a = board.actions.find((x) => x.id === p.id);
    if (!a) throw new ActionError('Actie niet gevonden.');
    a.done = !a.done;
  },
  'action.remove'(board, p) {
    board.actions = board.actions.filter((a) => a.id !== p.id);
  },

  'suggestion.accept'(board, p, member) {
    const s = board.aiSuggestions.find((x) => x.id === p.id);
    if (!s) throw new ActionError('Suggestie niet gevonden.');
    const idea = newIdea(board, { text: s.text, details: s.details, clusterId: p.clusterId ?? s.clusterId, lens: s.lens }, member);
    idea.fromAi = true;
    board.ideas.push(idea);
    board.aiSuggestions = board.aiSuggestions.filter((x) => x.id !== p.id);
  },
  'suggestion.dismiss'(board, p) {
    board.aiSuggestions = board.aiSuggestions.filter((x) => x.id !== p.id);
  },
};

const globalHandlers = {
  'opportunity.add'(state, p, member) {
    let { title, description } = p;
    let source = null;
    if (p.boardId && p.ideaId) {
      const board = state.boards[p.boardId];
      const idea = board?.ideas.find((i) => i.id === p.ideaId);
      if (!idea) throw new ActionError('Idee niet gevonden.');
      title ||= idea.text;
      description ||= idea.details;
      source = { boardId: board.id, ideaId: idea.id, boardTitle: board.title };
    }
    state.opportunities.push({
      id: id(),
      title: text(title, 200, { required: true }),
      description: text(description, 4000),
      stage: 'verkennen',
      ownerId: member,
      source,
      createdAt: now(),
      updatedAt: now(),
    });
  },
  'opportunity.update'(state, p) {
    const o = state.opportunities.find((x) => x.id === p.id);
    if (!o) throw new ActionError('Kans niet gevonden.');
    if ('title' in p) o.title = text(p.title, 200, { required: true });
    if ('description' in p) o.description = text(p.description, 4000);
    if ('stage' in p) {
      if (!OPPORTUNITY_STAGES.some((s) => s.key === p.stage)) throw new ActionError('Onbekende fase.');
      o.stage = p.stage;
    }
    if ('ownerId' in p && ROLE_KEYS.includes(p.ownerId)) o.ownerId = p.ownerId;
    o.updatedAt = now();
  },
  'opportunity.remove'(state, p) {
    state.opportunities = state.opportunities.filter((o) => o.id !== p.id);
  },
};

/**
 * Past een actie toe. Geeft terug wat er veranderd is zodat de server weet
 * wie bijgewerkt moet worden: { board } of { global: true }.
 */
export function applyAction(state, { boardId, type, payload = {} }, memberId) {
  if (globalHandlers[type]) {
    globalHandlers[type](state, payload, memberId);
    return { global: true };
  }
  const handler = boardHandlers[type];
  if (!handler) throw new ActionError(`Onbekende actie: ${type}`);
  const board = state.boards[boardId];
  if (!board) throw new ActionError('Sessie niet gevonden.');
  handler(board, payload, memberId);
  board.updatedAt = now();
  return { board };
}
