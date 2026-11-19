// AI-sparringpartner op basis van Claude. Optioneel: zonder ANTHROPIC_API_KEY
// (of een ander geldig Anthropic-credential) blijven alle andere functies werken.
import Anthropic from '@anthropic-ai/sdk';
import { ROLES, ROLE_KEYS } from './config.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

let client = null;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  client ??= new Anthropic();
  return client;
}

export class AiError extends Error {}

const SYSTEM = `Je bent een scherpe, constructieve sparringpartner voor een team van vier partners die samen een onderneming bouwen.

Het team:
- Enterprise Architect: kijkt naar landschap, capabilities, strategie en governance.
- Product Manager: kijkt naar klantwaarde, markt, validatie en onderscheidend vermogen.
- HR / Business Lead: kijkt naar mensen, organisatie, cultuur, verdienmodel en business case.
- Solution Architect: kijkt naar technische haalbaarheid, integraties, data en security.

Het team heeft diepe ervaring met ServiceNow (ITSM, ITOM, HRSD, CSM, SecOps, App Engine, IntegrationHub, Now Assist) en wil de horizon verbreden: andere platformen, sectoren, diensten en eigen producten. Help ze verder te kijken dan hun huidige comfortzone, maar benut ook expliciet hun bestaande sterktes (procesdenken, workflow-automatisering, enterprise-architectuur, implementatie-ervaring, verandermanagement).

Werkwijze:
- Schrijf in het Nederlands, zakelijk maar informeel (je/jullie).
- Wees concreet: noem waar relevant echte platformen, markten, standaarden of bedrijfsmodellen.
- Durf tegen te spreken en blinde vlekken te benoemen; vermijd algemeenheden.
- Houd het compact. Geen inleidende of afsluitende beleefdheidszinnen.`;

function boardContext(board, members) {
  const name = (mid) => members.find((m) => m.id === mid)?.name ?? mid;
  const cluster = (cid) => board.clusters.find((c) => c.id === cid)?.name ?? 'Overig';
  const lines = [
    `# Sessie: ${board.title}`,
    board.question && `Centrale vraag: ${board.question}`,
    board.description && `Context: ${board.description}`,
    `Thema's: ${board.clusters.map((c) => c.name).join(', ')}`,
    '',
    '## Ideeën',
  ];
  if (!board.ideas.length) lines.push('(nog geen ideeën)');
  for (const idea of board.ideas) {
    const votes = Object.values(idea.votes).reduce((a, b) => a + b, 0);
    lines.push(`- [${idea.id}] (${cluster(idea.clusterId)}; ${votes} stemmen; status ${idea.status}) ${idea.text}`);
    if (idea.details) lines.push(`  Toelichting: ${idea.details}`);
    for (const [mid, p] of Object.entries(idea.perspectives)) {
      lines.push(`  Perspectief ${ROLES[mid]?.label ?? mid} (${p.sentiment}): ${p.text}`);
    }
    for (const c of idea.comments.slice(-5)) lines.push(`  Opmerking ${name(c.authorId)}: ${c.text}`);
  }
  if (board.decisions.length) {
    lines.push('', '## Besluiten', ...board.decisions.map((d) => `- ${d.text}`));
  }
  if (board.notes) lines.push('', '## Sessienotities', board.notes.slice(0, 6000));
  return lines.filter((l) => l !== undefined && l !== false).join('\n');
}

async function call({ prompt, schema, effort = 'medium' }) {
  if (!aiEnabled()) throw new AiError('AI is niet geconfigureerd. Zet ANTHROPIC_API_KEY in de omgeving.');
  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('De API-sleutel voor Claude is ongeldig.');
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Even te veel verzoeken; probeer het zo opnieuw.');
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude gaf een fout (${err.status ?? 'netwerk'}).`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AiError('Claude wilde dit verzoek niet beantwoorden.');
  if (response.stop_reason === 'max_tokens') throw new AiError('Het antwoord werd te lang; probeer een kleinere vraag.');
  const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!schema) return out.trim();
  try {
    return JSON.parse(out);
  } catch {
    throw new AiError('Het antwoord van Claude kon niet worden verwerkt.');
  }
}

const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'details', 'lens', 'cluster'],
        properties: {
          text: { type: 'string', description: 'Het idee in één krachtige zin (max ~20 woorden).' },
          details: { type: 'string', description: 'Twee à drie zinnen toelichting: waarom kansrijk, hoe te starten.' },
          lens: { type: 'string', enum: ROLE_KEYS },
          cluster: { type: 'string', description: 'Naam van het best passende bestaande thema.' },
        },
      },
    },
  },
};

export async function generateIdeas(board, members, { count = 8, focus = '' } = {}) {
  const prompt = `${boardContext(board, members)}

---
Bedenk ${count} nieuwe, onderling verschillende ideeën die de centrale vraag beantwoorden en nog níet op het bord staan.
Verdeel ze over de vier perspectieven (lens: ea = Enterprise Architect, pm = Product Manager, hr = HR/Business Lead, sa = Solution Architect), zodat elke rol minstens één idee vanuit de eigen invalshoek krijgt.
Mix veilige uitbreidingen van wat het team al kan met een paar gedurfde ideeën die echt buiten de ServiceNow-wereld liggen.
Kies voor "cluster" exact één van deze thema's: ${board.clusters.map((c) => `"${c.name}"`).join(', ')}.${focus ? `\nExtra focus van het team: ${focus}` : ''}`;
  const { ideas } = await call({ prompt, schema: IDEAS_SCHEMA, effort: 'medium' });
  return ideas;
}

const CHALLENGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['perspectives', 'risks', 'assumptions', 'experiment'],
  properties: {
    perspectives: {
      type: 'object',
      additionalProperties: false,
      required: ROLE_KEYS,
      properties: Object.fromEntries(
        ROLE_KEYS.map((k) => [k, { type: 'string', description: `Kritische blik vanuit ${ROLES[k].label}: 2-3 zinnen met een scherpe vraag.` }]),
      ),
    },
    risks: { type: 'array', items: { type: 'string' }, description: 'De 3 grootste risico\'s.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'De 3 belangrijkste aannames die getoetst moeten worden.' },
    experiment: { type: 'string', description: 'Het kleinste experiment om binnen 2 weken te leren of dit idee hout snijdt.' },
  },
};

export async function challengeIdea(board, members, ideaId) {
  const idea = board.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new AiError('Idee niet gevonden.');
  const prompt = `${boardContext(board, members)}

---
Speel advocaat van de duivel voor dit idee: [${idea.id}] "${idea.text}"${idea.details ? ` (${idea.details})` : ''}.
Bekijk het door de bril van elk van de vier rollen, benoem risico's en aannames, en stel een klein, concreet experiment voor.`;
  return call({ prompt, schema: CHALLENGE_SCHEMA, effort: 'high' });
}

export async function summarize(board, members) {
  const prompt = `${boardContext(board, members)}

---
Maak een samenvatting van deze sessie in Markdown met de kopjes:
## Kern in drie zinnen
## Sterkste ideeën (met waarom)
## Waar de perspectieven botsen of blinde vlekken zitten
## Open vragen
## Voorgestelde volgende stappen (concreet, met suggestie welke rol trekt)`;
  return call({ prompt, effort: 'high' });
}

export async function ask(board, members, question, thread = []) {
  const history = thread
    .slice(-6)
    .map((t) => `Vraag van ${members.find((m) => m.id === t.by)?.name ?? t.by}: ${t.question}\nJouw antwoord: ${t.answer}`)
    .join('\n\n');
  const prompt = `${boardContext(board, members)}
${history ? `\n---\nEerder in dit gesprek:\n${history}\n` : ''}
---
Vraag van het team: ${question}`;
  return call({ prompt, effort: 'medium' });
}
