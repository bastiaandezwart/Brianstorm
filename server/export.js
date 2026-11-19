import { ROLES } from './config.js';

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const avg = (list) => {
  const v = list.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function boardToMarkdown(board, members) {
  const name = (mid) => members.find((m) => m.id === mid)?.name ?? mid;
  const out = [`# ${board.title}`, ''];
  if (board.question) out.push(`**Centrale vraag:** ${board.question}`, '');
  if (board.description) out.push(board.description, '');
  out.push(`_Geëxporteerd op ${new Date().toLocaleString('nl-NL')}_`, '');

  const ranked = [...board.ideas].sort((a, b) => sum(b.votes) - sum(a.votes));
  for (const cluster of board.clusters) {
    const ideas = ranked.filter((i) => i.clusterId === cluster.id);
    if (!ideas.length) continue;
    out.push(`## ${cluster.name}`, '');
    for (const idea of ideas) {
      const ratings = Object.values(idea.ratings);
      const impact = avg(ratings.map((r) => r.impact));
      const effort = avg(ratings.map((r) => r.effort));
      const meta = [
        `${sum(idea.votes)} ${sum(idea.votes) === 1 ? 'stem' : 'stemmen'}`,
        impact != null && `impact ${impact.toFixed(1)}`,
        effort != null && `inspanning ${effort.toFixed(1)}`,
        idea.status !== 'open' && idea.status,
        `door ${idea.fromAi ? 'AI-suggestie' : name(idea.authorId)}`,
      ].filter(Boolean);
      out.push(`### ${idea.text}`, `_${meta.join(' · ')}_`, '');
      if (idea.details) out.push(idea.details, '');
      for (const [mid, p] of Object.entries(idea.perspectives)) {
        out.push(`- **${ROLES[mid]?.label ?? mid}** (${p.sentiment}): ${p.text}`);
      }
      for (const c of idea.comments) out.push(`- 💬 ${name(c.authorId)}: ${c.text}`);
      out.push('');
    }
  }

  if (board.decisions.length) {
    out.push('## Besluiten', '', ...board.decisions.map((d) => `- ${d.text}`), '');
  }
  if (board.actions.length) {
    out.push('## Acties', '');
    for (const a of board.actions) {
      out.push(`- [${a.done ? 'x' : ' '}] ${a.text} — ${name(a.ownerId)}${a.due ? ` (voor ${a.due})` : ''}`);
    }
    out.push('');
  }
  if (board.notes) out.push('## Sessienotities', '', board.notes, '');
  if (board.aiSummary) out.push('## AI-samenvatting', '', board.aiSummary.text, '');
  return out.join('\n');
}
