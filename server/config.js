// Teamconfiguratie: de vier partners, hun rol-perspectief en de sessiesjablonen.
// Namen zijn via omgevingsvariabelen aan te passen (zie .env.example).

export const ROLES = {
  ea: {
    key: 'ea', label: 'Enterprise Architect', short: 'EA', color: '#1d4ed8', lens: 'Strategie & landschap',
    questions: [
      'Past dit bij waar onze klanten en de markt over drie tot vijf jaar staan?',
      'Welke capabilities en processen raken we, en waar overlapt het met wat er al is?',
      'Maakt dit klanten minder afhankelijk van één platform, of juist meer?',
      'Welke architectuurprincipes en governance vraagt dit van de klant?',
    ],
  },
  pm: {
    key: 'pm', label: 'Product Manager', short: 'PM', color: '#15803d', lens: 'Klant & propositie',
    questions: [
      'Welk probleem lossen we op, en voor wie precies?',
      'Waarom zou een klant hier nú voor betalen?',
      'Wat is de kleinste versie waarmee we het kunnen valideren?',
      'Wat maakt ons anders dan de alternatieven?',
    ],
  },
  hr: {
    key: 'hr', label: 'HR / Business Lead', short: 'BL', color: '#b45309', lens: 'Business & mensen',
    questions: [
      'Wat is het verdienmodel, en klopt de business case?',
      'Welke mensen en competenties hebben we nodig, en hebben we die?',
      'Past dit bij onze cultuur en hoe we willen samenwerken?',
      "Welke commerciële en organisatorische risico's lopen we?",
    ],
  },
  sa: {
    key: 'sa', label: 'Solution Architect', short: 'SA', color: '#7e22ce', lens: 'Oplossing & realisatie',
    questions: [
      'Kunnen we dit bouwen, en met welke bouwstenen en platformen?',
      'Welke integraties, data en beveiliging zijn kritisch?',
      'Wat kunnen we hergebruiken uit onze ServiceNow-ervaring?',
      'Hoeveel werk is een eerste versie, en waar zit de grootste technische onzekerheid?',
    ],
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

export function membersFromEnv(env = process.env) {
  return ROLE_KEYS.map((key) => ({
    id: key,
    role: key,
    name: env[`MEMBER_${key.toUpperCase()}_NAME`] || ROLES[key].label,
  }));
}

// Fasen van een sessie: eerst divergeren (veel ideeën), dan convergeren (kiezen).
export const PHASES = [
  { key: 'verkennen', label: 'Verkennen', hint: 'Context en vraag scherp krijgen.' },
  { key: 'ideeen', label: 'Ideeën genereren', hint: 'Kwantiteit boven kwaliteit. Nog niet oordelen.' },
  { key: 'perspectieven', label: 'Perspectieven', hint: 'Elke rol bekijkt de beste ideeën door de eigen bril.' },
  { key: 'prioriteren', label: 'Prioriteren', hint: 'Stemmen en scoren op impact en inspanning.' },
  { key: 'besluiten', label: 'Besluiten & acties', hint: 'Wat doen we, wie pakt het op, wanneer?' },
];

export const OPPORTUNITY_STAGES = [
  { key: 'verkennen', label: 'Verkennen' },
  { key: 'valideren', label: 'Valideren' },
  { key: 'bouwen', label: 'Bouwen' },
  { key: 'geparkeerd', label: 'Geparkeerd' },
];

export const TEMPLATES = [
  {
    key: 'horizon',
    title: 'Horizon verbreden',
    question: 'Op welke gebieden naast ServiceNow kunnen wij als team waarde toevoegen?',
    description:
      'Verken nieuwe platformen, markten en diensten die aansluiten op onze gezamenlijke kennis van architectuur, product, mensen en oplossingen.',
    clusters: ['Andere platformen', 'Nieuwe markten / sectoren', 'Nieuwe diensten', 'AI & data', 'Eigen producten'],
  },
  {
    key: 'propositie',
    title: 'Nieuwe propositie ontwerpen',
    question: 'Hoe ziet een aantrekkelijke propositie eruit voor [doelgroep]?',
    description: 'Werk één kans uit tot een propositie: probleem, oplossing, waarde, verdienmodel en eerste stap.',
    clusters: ['Klantprobleem', 'Oplossing', 'Waardepropositie', 'Verdienmodel', 'Eerste experiment'],
  },
  {
    key: 'samenwerking',
    title: 'Ons samenwerkingsmodel',
    question: 'Hoe willen wij als vier partners samenwerken en groeien?',
    description: 'Rollen, verantwoordelijkheden, besluitvorming, verdeling en ambities van het partnerschap.',
    clusters: ['Rollen & verantwoordelijkheden', 'Besluitvorming', 'Financieel model', 'Groei & mensen', 'Cultuur & waarden'],
  },
  {
    key: 'premortem',
    title: 'Pre-mortem',
    question: 'Stel: over een jaar is dit initiatief mislukt. Wat is er gebeurd?',
    description: 'Benoem vooraf de risico\'s vanuit elk perspectief en bedenk maatregelen.',
    clusters: ['Markt & klant', 'Techniek', 'Mensen & organisatie', 'Financieel', 'Maatregelen'],
  },
  {
    key: 'vrij',
    title: 'Vrije brainstorm',
    question: '',
    description: '',
    clusters: ['Ideeën'],
  },
];

export const MAX_VOTES_PER_MEMBER = 5;
