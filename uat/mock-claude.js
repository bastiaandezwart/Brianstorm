(() => {
  const u = new URLSearchParams(location.search).get('u');
  const RO = new URLSearchParams(location.search).get('ro') === '1';
  const NAMES = { u_bas: 'Bastiaan', u_anna: 'Anna Jansen', u_erik: 'Erik de Vries', u_hanna: 'Hanna Bakker', u_vijf: 'Vera Vijf', u_kijk: 'Kees Kijker' };
  const ch = new BroadcastChannel('mock');
  const load = () => JSON.parse(localStorage.getItem('mockdb') || '{}');
  const save = (s) => localStorage.setItem('mockdb', JSON.stringify(s));
  const listeners = new Set();
  const notify = () => { for (const l of listeners) l(); };
  ch.onmessage = (e) => { if (e.data === 'db') notify(); else if (e.data?.peer) { peers[e.data.peer.peer] = e.data.peer; firePeers(); } };
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], v) : v; return o; };
  const write = (fn) => { if (RO) throw { code: 'invalid_argument' }; const s = load(); fn(s); save(s); setTimeout(() => { notify(); ch.postMessage('db'); }, 5); };
  const snapDoc = (id, data) => ({ id, exists: !!data, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } });
  const docRef = (path) => ({ id: path.split('/').pop(), path,
    get: async () => snapDoc(path.split('/').pop(), load()[path]),
    set: async (d) => write((s) => { s[path] = JSON.parse(JSON.stringify(d)); }),
    update: async (d) => write((s) => { if (!s[path]) throw { code: 'invalid_argument' }; s[path] = merge(s[path], JSON.parse(JSON.stringify(d))); }),
    delete: async () => write((s) => { delete s[path]; }),
  });
  const db = {
    doc: docRef,
    collection: (coll) => ({ path: coll,
      doc: (id) => docRef(`${coll}/${id ?? Math.random().toString(36).slice(2, 12)}`),
      onSnapshot(next) {
        const run = () => { const s = load(); const docs = Object.keys(s).filter((p) => p.startsWith(coll + '/') && p.split('/').length === 2).sort().map((p) => snapDoc(p.split('/')[1], s[p])); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); };
        listeners.add(run); setTimeout(run, 20); return () => listeners.delete(run);
      },
    }),
  };
  const user = { id: async () => u, can: async () => !RO, isOwner: async () => u === 'u_bas', canEdit: async () => true,
    profiles: async (ids) => Object.fromEntries([].concat(ids).map((id) => [id, { id, name: NAMES[id] || '', avatarUrl: '', color: '#888', email: null, isMe: id === u, guest: false }])) };
  const peers = {}; let peerHandler = null;
  const firePeers = () => peerHandler?.({ peers: Object.values(peers), joined: [], left: [], updated: [] });
  const room = { onPeers: (h) => { peerHandler = h; firePeers(); return () => {}; },
    presence: async (patch) => { const me = { peer: 'p_' + u, by: u, isMe: true, kind: 'viewer', guest: false, presence: patch, updatedAt: Date.now() }; peers[me.peer] = me; firePeers(); ch.postMessage({ peer: { ...me, isMe: false } }); } };
  const sample = async (input, opts = {}) => { const text = '## Kern\nPower Platform is de logische eerste stap.\n- **Sterk**: hergebruik van workflowkennis\n- Volgende stap: marktverkenning'; opts.onText?.({ text, delta: text }); return { text, truncated: false, modelTierApplied: 'default' }; };
  sample.json = async (prompt) => prompt.includes('niemand in het team vertegenwoordigt') ? { klant: { text: 'Klanten zien vooral minder handwerk.', sentiment: 'kans' }, gtm: { text: 'Instap via het Microsoft-partnerprogramma.', sentiment: 'kans' }, risico: { text: 'Let op AVG bij burgerzaken.', sentiment: 'zorg' } } : prompt.includes('advocaat') ? { perspectives: { ea: 'Hoe voorkom je nieuwe lock-in?', pm: 'Wie is de eerste klant?', hr: 'Hebben we de mensen?', sa: 'Welke integraties zijn kritisch?' }, risks: ['Concurrentie', 'Te weinig capaciteit', 'Lange salescyclus'], assumptions: ['Klanten willen multi-platform', 'Kennis is overdraagbaar', 'Marges zijn vergelijkbaar'], experiment: 'Interview vijf bestaande klanten.' }
    : [{ text: 'Copilot Studio-agents voor de zorg', details: 'Combineer workflow-ervaring met AI-agents.', lens: 'pm', cluster: 'AI & data' }, { text: 'Architectuur-as-a-service voor het MKB', details: 'Vaste maandprijs.', lens: 'ea', cluster: 'Nieuwe diensten' }];
  const caps = { db, user, room, sample, downloads: { save: async () => ({ status: 'saved' }) } };
  window.claude = { use: async (n) => caps[n] ?? null };
})();
