import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionError, applyAction, createBoard } from '../server/actions.js';
import { MAX_VOTES_PER_MEMBER } from '../server/config.js';
import { boardToMarkdown } from '../server/export.js';

const freshState = () => ({ boards: {}, opportunities: [], sessions: {} });
const members = [
  { id: 'ea', role: 'ea', name: 'Anna' },
  { id: 'pm', role: 'pm', name: 'Piet' },
  { id: 'hr', role: 'hr', name: 'Hanna' },
  { id: 'sa', role: 'sa', name: 'Sam' },
];

function setup() {
  const state = freshState();
  const board = createBoard(state, { template: 'horizon' }, 'sa');
  const run = (type, payload, member = 'sa') => applyAction(state, { boardId: board.id, type, payload }, member);
  return { state, board, run };
}

test('nieuwe sessie neemt vraag en thema\'s over uit het sjabloon', () => {
  const { board } = setup();
  assert.equal(board.title, 'Horizon verbreden');
  assert.match(board.question, /ServiceNow/);
  assert.equal(board.clusters.length, 5);
  assert.equal(board.phase, 'verkennen');
});

test('idee toevoegen valt terug op eerste thema bij onbekend thema', () => {
  const { board, run } = setup();
  run('idea.add', { text: '  Microsoft Power Platform-practice  ', clusterId: 'bestaat-niet', lens: 'pm' });
  const [idea] = board.ideas;
  assert.equal(idea.text, 'Microsoft Power Platform-practice');
  assert.equal(idea.clusterId, board.clusters[0].id);
  assert.equal(idea.lens, 'pm');
  assert.equal(idea.authorId, 'sa');
});

test('leeg idee wordt geweigerd', () => {
  const { run } = setup();
  assert.throws(() => run('idea.add', { text: '   ' }), ActionError);
});

test('stemmen zijn begrensd per partner en kunnen worden teruggenomen', () => {
  const { board, run } = setup();
  run('idea.add', { text: 'A' });
  const id = board.ideas[0].id;
  for (let i = 0; i < MAX_VOTES_PER_MEMBER; i++) run('idea.vote', { id, delta: 1 }, 'pm');
  assert.throws(() => run('idea.vote', { id, delta: 1 }, 'pm'), /stemmen/);
  run('idea.vote', { id, delta: 1 }, 'ea'); // andere partner mag wel
  run('idea.vote', { id, delta: -1 }, 'pm');
  assert.deepEqual(board.ideas[0].votes, { pm: MAX_VOTES_PER_MEMBER - 1, ea: 1 });
});

test('perspectief per rol opslaan en weer wissen', () => {
  const { board, run } = setup();
  run('idea.add', { text: 'AI-agents voor HR-processen' });
  const id = board.ideas[0].id;
  run('idea.perspective', { id, text: 'Sluit aan op HRSD-kennis', sentiment: 'kans' }, 'hr');
  assert.equal(board.ideas[0].perspectives.hr.sentiment, 'kans');
  run('idea.perspective', { id, text: '' }, 'hr');
  assert.equal(board.ideas[0].perspectives.hr, undefined);
});

test('scores worden begrensd tussen 1 en 5, los in te vullen en te wissen', () => {
  const { board, run } = setup();
  run('idea.add', { text: 'X' });
  const id = board.ideas[0].id;
  run('idea.rate', { id, impact: 9 }, 'ea');
  assert.deepEqual(board.ideas[0].ratings.ea, { impact: 5 }); // geen verzonnen inspanning
  run('idea.rate', { id, effort: -3 }, 'ea');
  assert.deepEqual(board.ideas[0].ratings.ea, { impact: 5, effort: 1 });
  run('idea.rate', { id, impact: null }, 'ea');
  run('idea.rate', { id, effort: null }, 'ea');
  assert.equal(board.ideas[0].ratings.ea, undefined);
});

test('thema verwijderen verhuist ideeën; laatste thema blijft', () => {
  const { board, run } = setup();
  const second = board.clusters[1].id;
  run('idea.add', { text: 'Y', clusterId: second });
  run('cluster.remove', { id: second });
  assert.equal(board.ideas[0].clusterId, board.clusters[0].id);
  while (board.clusters.length > 1) run('cluster.remove', { id: board.clusters[0].id });
  assert.throws(() => run('cluster.remove', { id: board.clusters[0].id }), ActionError);
});

test('idee naar kansenradar en door fases schuiven', () => {
  const { state, board, run } = setup();
  run('idea.add', { text: 'Eigen product: architectuur-assessment', details: 'SaaS-tool' });
  applyAction(state, { type: 'opportunity.add', payload: { boardId: board.id, ideaId: board.ideas[0].id } }, 'pm');
  const [opp] = state.opportunities;
  assert.equal(opp.title, 'Eigen product: architectuur-assessment');
  assert.equal(opp.source.boardId, board.id);
  applyAction(state, { type: 'opportunity.update', payload: { id: opp.id, stage: 'valideren' } }, 'pm');
  assert.equal(opp.stage, 'valideren');
  assert.throws(() => applyAction(state, { type: 'opportunity.update', payload: { id: opp.id, stage: 'x' } }, 'pm'), ActionError);
});

test('AI-suggestie accepteren maakt een idee', () => {
  const { board, run } = setup();
  board.aiSuggestions.push({ id: 's1', text: 'Salesforce-practice', details: '', lens: 'pm', clusterId: board.clusters[0].id });
  run('suggestion.accept', { id: 's1' });
  assert.equal(board.ideas[0].text, 'Salesforce-practice');
  assert.equal(board.ideas[0].fromAi, true);
  assert.equal(board.aiSuggestions.length, 0);
});

test('onbekende actie geeft nette fout', () => {
  const { run } = setup();
  assert.throws(() => run('bestaat.niet', {}), /Onbekende actie/);
});

test('markdown-export bevat ideeën, perspectieven en acties', () => {
  const { board, run } = setup();
  run('idea.add', { text: 'Data & AI-diensten' });
  const id = board.ideas[0].id;
  run('idea.perspective', { id, text: 'Groeimarkt', sentiment: 'kans' }, 'pm');
  run('action.add', { text: 'Marktverkenning', ownerId: 'pm', due: '2026-12-01' });
  const out = boardToMarkdown(board, members);
  assert.match(out, /### Data & AI-diensten/);
  assert.match(out, /\*\*Product Manager\*\* \(kans\): Groeimarkt/);
  assert.match(out, /- \[ \] Marktverkenning — Piet \(voor 2026-12-01\)/);
});
