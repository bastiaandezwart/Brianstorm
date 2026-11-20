// UAT: scenario's vanuit de gebruiker. Elk scenario: PASS / FAIL / BEVINDING (werkt, maar kan beter).
const { chromium } = require('playwright');
const fs = require('fs');
const results = [];
const rec = (id, name, status, note = '') => { results.push({ id, name, status, note }); console.log(`${status.padEnd(9)} ${id} ${name}${note ? ' — ' + note : ''}`); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  ctx.setDefaultTimeout(8000);
  await ctx.addInitScript({ content: fs.readFileSync(__dirname + '/mock-claude.js', 'utf8') });
  await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(require.resolve('morphdom/dist/morphdom-umd.min.js'), 'utf8') }));
  await ctx.route('https://fonts.**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  const errors = [];
  const open = async (u, extra = '', vp) => { const p = await ctx.newPage(); if (vp) await p.setViewportSize(vp); p.on('pageerror', (e) => errors.push(`${u}: ${e.message}`)); await p.goto(`http://localhost:3456/index.html?u=${u}${extra}`); return p; };
  const T = async (id, name, fn) => { try { const r = await fn(); if (r && r.status) rec(id, name, r.status, r.note); else rec(id, name, 'PASS'); } catch (e) { rec(id, name, 'FAIL', String(e.message).split('\n')[0].slice(0, 160)); } };

  let A, B, C, D, hash;
  await T('U01', 'Eerste bezoek: inchecken met voornaam en uitleg zien', async () => {
    A = await open('u_bas'); await A.waitForSelector('.role-pick', { timeout: 4000 });
    await A.click('[data-action=check-in][data-person=bastiaan]'); await A.waitForSelector('.help-steps');
  });
  await T('U02', 'Sessie starten vanuit sjabloon met eigen vraag', async () => {
    await A.click('[data-action=toggle-new-board]'); await A.click('[data-action=pick-template][data-key=horizon]');
    await A.fill('#nb-question', 'Welke markt pakken we als eerste naast ServiceNow?'); await A.click('[data-action=create-board]');
    await A.waitForSelector('.board-head h1'); hash = await A.evaluate(() => location.hash);
    if (!(await A.textContent('.question')).includes('Welke markt')) throw new Error('vraag niet overgenomen');
  });
  await T('U03', 'Ideeën toevoegen met Enter; leeg idee geeft hint', async () => {
    for (const t of ['Power Platform-practice', 'AI-agents voor HR', 'SaaS-tool architectuur-assessment', 'Zorgsector: workflow ziekenhuizen']) { await A.fill('#idea-text', t); await A.keyboard.press('Enter'); await A.waitForTimeout(60); }
    await A.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    await A.fill('#idea-text', ''); await A.click('[data-action=add-idea]'); await A.waitForSelector('.toast >> text=Typ eerst');
  });
  await T('U04', 'Lang idee (>280 tekens) wordt niet stil afgekapt', async () => {
    await A.fill('#idea-text', 'L'.repeat(300));
    const len = (await A.inputValue('#idea-text')).length; const cnt = await A.textContent('#idea-count');
    await A.fill('#idea-text', ''); await A.dispatchEvent('#idea-text', 'input');
    if (len !== 280 || !cnt.includes('280/280')) throw new Error(`lengte ${len}, teller ${cnt}`);
  });
  await T('U05', 'Thema toevoegen, hernoemen en verwijderen', async () => {
    await A.click('[data-action=toggle-add-cluster]'); await A.fill('#new-cluster', 'Partnerschappen'); await A.keyboard.press('Enter');
    await A.waitForSelector('.column-head h2 >> text=Partnerschappen');
    const n = await A.locator('.column').count();
    await A.click(`.column >> nth=${n - 1} >> [data-action=rename-cluster]`); await A.fill(`.column >> nth=${n - 1} >> input`, 'Allianties'); await A.keyboard.press('Enter');
    await A.waitForSelector('.column-head h2 >> text=Allianties');
    await A.click(`.column >> nth=${n - 1} >> [data-action=remove-cluster]`); await A.click('[data-action=modal-confirm]');
    await A.waitForFunction((n) => document.querySelectorAll('.column').length === n - 1, n);
  });
  await T('U06', 'Tweede partner ziet alles live; eigen typen blijft staan', async () => {
    B = await open('u_anna'); await B.click('[data-action=check-in][data-person=joey]'); await B.click('[data-action=open-board]');
    await B.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    await B.fill('#idea-text', 'Concept van Anna');
    await A.fill('#idea-text', 'Data & AI-diensten'); await A.keyboard.press('Enter');
    await B.waitForFunction(() => document.querySelectorAll('.card').length === 5);
    if ((await B.inputValue('#idea-text')) !== 'Concept van Anna') throw new Error('typen overschreven');
  });
  await T('U07', 'Stemmen: maximaal 5, terugnemen kan', async () => {
    for (let i = 0; i < 5; i++) { await B.click(`.card >> nth=${i} >> [data-action=vote][data-delta="1"]`); await B.waitForTimeout(60); }
    await B.click('.card >> nth=0 >> [data-action=vote][data-delta="1"]'); await B.waitForSelector('.toast >> text=al je 5 stemmen');
    await B.click('[data-action=vote][data-delta="-1"] >> nth=0'); await B.waitForTimeout(150);
    if (!(await B.textContent('.small[aria-live]')).includes('nog 1')) throw new Error('teller klopt niet');
  });
  await T('U08', 'Idee op shortlist zetten zonder het te openen', async () => {
    await A.click('.card >> nth=1 >> [data-action=quick-shortlist]');
    await B.waitForFunction(() => document.querySelectorAll('.card.shortlist').length === 1);
    await A.click('.card.shortlist [data-action=quick-shortlist]');
    await B.waitForFunction(() => document.querySelectorAll('.card.shortlist').length === 0);
  });
  await T('U09', 'Idee bewerken in lade: tekst, toelichting, thema, shortlist', async () => {
    await A.click('.card-open >> nth=0'); await A.waitForSelector('.drawer');
    await A.fill('#d-details', 'Instappen via Microsoft-partnerprogramma.'); await A.selectOption('#d-cluster', { index: 2 });
    await A.click('[data-action=idea-status][data-status=shortlist]');
    await A.keyboard.press('Escape'); await A.waitForTimeout(200);
    const ok = await B.evaluate(() => document.querySelectorAll('.card.shortlist').length >= 1);
    if (!ok) throw new Error('shortlist niet zichtbaar bij partner');
  });
  await T('U10', 'Oordeel geven; dat van een ander is niet te bewerken', async () => {
    await A.click('.tab[data-key=perspectieven]'); await A.click('.pcell.mine >> nth=0');
    await A.fill('#persp-bastiaan', 'Goed haalbaar, workflowkennis herbruikbaar.'); await A.click('[data-action=sentiment][data-key=bastiaan][data-sentiment=kans]');
    if (await A.locator('#persp-joey').count()) throw new Error('kan oordeel van Joey bewerken');
    await A.keyboard.press('Escape');
  });
  await T('U11', 'Reactie plaatsen en eigen reactie verwijderen', async () => {
    await A.click('.pcell.idea >> nth=0'); await A.fill('.drawer input[placeholder="Reageer…"]', 'Wie kent iemand bij Microsoft?'); await A.keyboard.press('Enter');
    await A.waitForSelector('.comment');
    await A.click('.comment [data-action=remove-comment]'); await A.waitForSelector('.comment', { state: 'detached' });
    await A.keyboard.press('Escape');
  });
  await T('U12', 'Prioriteren: lege matrix legt uit wat te doen; scores tonen punt', async () => {
    await A.click('.tab[data-key=matrix]');
    const hint = await A.locator('.matrix-empty').count(); if (!hint) throw new Error('geen uitleg in lege matrix');
    await A.click('.rate-row >> nth=0 >> [data-field=impact][data-value="5"]'); await A.click('.rate-row >> nth=0 >> [data-field=effort][data-value="2"]');
    await A.waitForSelector('.matrix .dot');
    if (await A.locator('.matrix-empty').count()) throw new Error('uitleg blijft staan na score');
  });
  await T('U13', 'Besluit en actie vastleggen; eigenaar/deadline later aanpassen', async () => {
    await A.click('.tab[data-key=acties]');
    await A.fill('#decision-text', 'We starten met Power Platform'); await A.keyboard.press('Enter');
    await A.fill('#action-text', 'Partnerprogramma uitzoeken'); await A.selectOption('#action-owner', 'u_anna'); await A.keyboard.press('Enter');
    await A.waitForSelector('tr >> text=Partnerprogramma uitzoeken');
    await A.click('[data-change=toggle-action]'); await A.waitForSelector('tr.done');
    await A.selectOption('tr [data-change=action-owner]', 'u_bas'); await A.fill('tr [data-change=action-due]', '2026-12-15'); await A.press('tr [data-change=action-due]', 'Tab');
    await B.click('.tab[data-key=acties]'); await B.waitForSelector('tr [data-change=action-owner]'); await B.waitForTimeout(250);
    if ((await B.inputValue('tr [data-change=action-owner]')) !== 'u_bas' || (await B.inputValue('tr [data-change=action-due]')) !== '2026-12-15') throw new Error('wijziging niet bij partner');
  });
  await T('U14', 'Notities: gelijktijdig typen overschrijft elkaar niet ongemerkt', async () => {
    await A.fill('#board-notes', 'Notitie van Bastiaan');
    await B.click('#board-notes'); await B.type('#board-notes', 'Notitie van Anna');
    await A.click('#decision-text'); await A.waitForTimeout(150); // A slaat op
    if (!(await B.locator('.notes-warning').count())) throw new Error('geen waarschuwing tijdens typen');
    await B.click('#decision-text'); await B.waitForSelector('[data-action=notes-both]'); await B.click('[data-action=notes-both]'); await B.waitForTimeout(250);
    const merged = await A.inputValue('#board-notes');
    if (!merged.includes('Notitie van Bastiaan') || !merged.includes('Notitie van Anna')) throw new Error('niet samengevoegd: ' + merged);
  });
  await T('U15', 'Claude: ideeën genereren, accepteren, negeren', async () => {
    await A.click('.tab[data-key=ideeen]'); await A.click('[data-action=ai-ideas]'); await A.waitForSelector('.suggestion');
    await A.click('[data-action=accept-suggestion] >> nth=0'); await A.click('[data-action=dismiss-suggestion] >> nth=0');
    await A.waitForFunction(() => !document.querySelector('.suggestion'));
  });
  await T('U16', 'Claude: advocaat, extra perspectieven, samenvatting, vraag', async () => {
    await A.click('.card-open >> nth=0'); await A.click('[data-action=ai-challenge]'); await A.waitForSelector('.challenge');
    await A.click('[data-action=ai-extra]'); await A.waitForSelector('.persp .meta'); await A.keyboard.press('Escape');
    await A.click('.tab[data-key=ai]'); await A.click('[data-action=ai-summary]'); await A.waitForSelector('.panel .md h3');
    await A.click('[data-action=ask-preset] >> nth=0'); await A.waitForSelector('.a-bubble');
  });
  await T('U17', 'Zoeken/filteren in ideeën', async () => {
    await A.click('.tab[data-key=ideeen]');
    await A.fill('#idea-search', 'ziekenhuizen'); await A.waitForTimeout(100);
    const n = await A.locator('.card').count(); const st = await A.textContent('[role=status] >> text=zichtbaar');
    await A.click('[data-action=clear-filter]');
    if (n !== 1 || !st.includes('1 van')) throw new Error(`zoekresultaat ${n}`);
  });
  await T('U18', 'Timebox starten en stoppen (zichtbaar bij partner)', async () => {
    await A.click('[data-action=timer][data-min="5"]'); await B.waitForSelector('#timer'); await A.click('[data-action=timer][data-min="0"]'); await B.waitForSelector('#timer', { state: 'detached' });
  });
  await T('U19', 'Idee naar kansenradar, fase wijzigen, beschrijving aanvullen', async () => {
    await A.click('.card-open >> nth=0'); await A.click('[data-action=to-radar]'); await A.keyboard.press('Escape');
    await A.click('[data-action=home]'); await A.waitForSelector('.opp');
    await A.selectOption('.opp select[data-change=opp-stage]', 'valideren'); await A.waitForSelector('.kanban-col:nth-child(2) .opp');
    await A.click('.opp [data-action=edit-opp]'); await A.fill('.opp textarea', 'Eerst drie klantgesprekken plannen.'); await A.click('.opp [data-action=edit-opp]');
    await A.waitForSelector('.opp >> text=Eerst drie klantgesprekken');
  });
  await T('U20', 'Export: Markdown downloaden', async () => {
    await A.click('[data-action=open-board]'); await A.click('[data-action=download-md]');
  });
  await T('U21', 'Gast (alle vier ingecheckt) kan meedoen', async () => {
    C = await open('u_erik'); await C.click('[data-action=check-in][data-person=mart]');
    D = await open('u_hanna'); await D.click('[data-action=check-in][data-person=timon]');
    const E = await open('u_vijf'); await E.waitForSelector('.role-pick');
    const way = await E.locator('[data-action=as-guest]').count();
    if (!way) throw new Error('alle rollen bezet: geen manier om verder te gaan');
    await E.click('[data-action=as-guest]'); await E.waitForSelector('.hero');
    await E.click('[data-action=open-board]'); await E.fill('#idea-text', 'Idee van een gast'); await E.keyboard.press('Enter'); await A.waitForSelector('.card >> text=Idee van een gast').catch(() => {});
  });
  await T('U22', 'Alleen-lezen gebruiker kan meekijken', async () => {
    const R = await open('u_kijk', '&ro=1'); await R.waitForTimeout(400);
    const stuck = await R.locator('.role-pick').count();
    if (stuck) throw new Error('blijft hangen op rolkeuze, ziet geen sessies');
    await R.waitForSelector('.board-card'); await R.click('.board-card'); await R.waitForSelector('.card');
  });
  await T('U23', 'Sessie archiveren en terughalen', async () => {
    await A.click('[data-action=toggle-edit-header]'); await A.click('[data-action=archive-board]'); await A.click('[data-action=toggle-edit-header]');
    await A.click('[data-action=home]'); await A.click('[data-action=toggle-archived]'); await A.waitForSelector('.board-card');
    await A.click('.board-card'); await A.click('[data-action=toggle-edit-header]'); await A.click('[data-action=archive-board]'); await A.click('[data-action=toggle-edit-header]');
  });
  await T('U24', 'Mobiel (390px): bord bruikbaar, geen zijwaarts scrollen', async () => {
    const M = await open('u_anna', hash, { width: 390, height: 844 }); await M.waitForSelector('.card');
    if (await M.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('pagina scrolt zijwaarts');
    await M.click('.card-open >> nth=0'); await M.waitForSelector('.drawer');
    const w = await M.evaluate(() => document.querySelector('.drawer').getBoundingClientRect().width); if (w > 391) throw new Error('lade te breed');
  });
  await T('U25', 'Sessie verwijderen met bevestiging', async () => {
    await A.click('[data-action=home]'); await A.click('[data-action=toggle-new-board]'); await A.click('[data-action=pick-template][data-key=vrij]'); await A.fill('#nb-title', 'Testsessie'); await A.click('[data-action=create-board]');
    await A.click('[data-action=toggle-edit-header]'); await A.click('[data-action=delete-board]'); await A.click('[data-action=modal-confirm]'); await A.waitForSelector('.hero');
    await A.waitForSelector('.board-card >> text=Testsessie', { state: 'detached', timeout: 5000 }).catch(() => { throw new Error('sessie niet verwijderd'); });
  });
  await T('U26', 'Toegankelijkheid (axe, WCAG 2.2 AA) op bord en startpagina', async () => {
    const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    const out = [];
    for (const [p, sel] of [[A, null], [B, null]]) { await p.addScriptTag({ content: AXE }); const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((x) => x.id)); out.push(...v); }
    if (out.length) throw new Error(out.join(', '));
  });
  await T('U28', 'Alleen voornamen zichtbaar, ook voor accounts met een volledige naam', async () => {
    const txt = await A.evaluate(() => document.body.innerText);
    for (const full of ['Anna Jansen', 'Erik de Vries', 'Hanna Bakker', 'Vera Vijf']) if (txt.includes(full)) throw new Error('volledige naam zichtbaar: ' + full);
    if (!txt.includes('Joey')) throw new Error('voornaam Joey ontbreekt');
  });
  await T('U29', 'Eigen expertise invullen; zichtbaar bij partner', async () => {
    await A.click('[data-action=home]'); await A.click('[data-action=edit-expertise][data-key=bastiaan]');
    await A.fill('#exp-bastiaan', 'Solution Architect, ServiceNow-integraties en oplossingsontwerp.'); await A.click('[data-action=edit-expertise][data-key=""]');
    await B.click('[data-action=home]'); await B.waitForSelector('.team-card >> text=ServiceNow-integraties', { timeout: 3000 });
    if (await B.locator('[data-action=edit-expertise][data-key=bastiaan]').count()) throw new Error('Joey kan de kaart van Bastiaan bewerken');
  });
  await T('U30', 'Claude krijgt de expertise mee bij het genereren van ideeën', async () => {
    await A.click('[data-action=open-board]'); await A.click('.tab[data-key=ideeen]');
    await A.click('[data-action=ai-ideas]'); await A.waitForSelector('.suggestion');
    const prompt = await A.evaluate(() => window.__lastPrompt || '');
    if (!prompt.includes('ServiceNow-integraties en oplossingsontwerp')) throw new Error('expertise niet in prompt');
    if (!prompt.includes('Joey') || /Enterprise Architect|Product Manager/.test(prompt)) throw new Error('prompt bevat nog rollen of mist namen');
    if (!(await A.locator('.suggestion >> text=Past bij').count())) throw new Error('geen "Past bij" bij suggesties');
    await A.click('[data-action=dismiss-suggestion] >> nth=0'); await A.click('[data-action=dismiss-suggestion] >> nth=0');
  });
  await T('U31', 'Startpagina toont wat er nieuw is sinds je laatste bezoek', async () => {
    await A.click('[data-action=home]'); await A.waitForSelector('.hero');
    await B.click('[data-action=open-board]'); await B.fill('#idea-text', 'Nieuw idee van Joey terwijl Bastiaan weg is'); await B.keyboard.press('Enter');
    await A.waitForSelector('.board-card .new-badge', { timeout: 4000 });
    await A.waitForSelector('.news >> text=Nieuw idee van Joey');
    await A.click('.news button >> text=Nieuw idee van Joey'); await A.waitForSelector('.drawer');
    if (!(await A.inputValue('#d-text')).includes('Nieuw idee van Joey')) throw new Error('verkeerd idee geopend');
    await A.keyboard.press('Escape');
  });
  await T('U32', 'In de sessie: balk met nieuws, alleen nieuwe tonen, gelezen', async () => {
    await A.waitForSelector('.since-bar >> text=1 nieuw idee');
    await A.click('[data-action=only-new]'); await A.waitForTimeout(100);
    const n = await A.locator('.card').count(); if (n !== 1) throw new Error(`alleen-nieuw toont ${n} kaarten`);
    if (!(await A.locator('.card .new-badge').count())) throw new Error('geen Nieuw-label op kaart');
    await A.click('[data-action=mark-read]'); await A.waitForSelector('.since-bar', { state: 'detached' });
    if ((await A.locator('.card').count()) < 2) throw new Error('filter niet opgeheven');
  });
  await T('U33', 'Stille ronde: privé schrijven, tegelijk onthullen', async () => {
    const before = await B.locator('.card').count();
    await A.click('[data-action=silent-start][data-min="5"]'); await B.waitForSelector('.silent >> text=Stille ronde loopt');
    await A.fill('#idea-text', 'Geheim idee van Bastiaan'); await A.keyboard.press('Enter');
    await B.fill('#idea-text', 'Geheim idee van Joey'); await B.keyboard.press('Enter');
    await B.waitForSelector('.silent .badge >> text=Bastiaan: 1');
    if ((await B.locator('.card').count()) !== before) throw new Error('privé idee zichtbaar als kaart');
    if ((await B.evaluate(() => document.body.innerText)).includes('Geheim idee van Bastiaan')) throw new Error('Joey ziet het idee van Bastiaan');
    if (!(await B.locator('.silent li >> text=Geheim idee van Joey').count())) throw new Error('eigen privé idee niet getoond');
    await A.click('[data-action=silent-reveal]'); await A.click('[data-action=modal-confirm]');
    await B.waitForSelector('.card >> text=Geheim idee van Bastiaan', { timeout: 5000 }); await B.waitForSelector('.card >> text=Geheim idee van Joey', { timeout: 5000 });
    await A.waitForSelector('.card >> text=Geheim idee van Joey', { timeout: 5000 });
    await A.waitForSelector('.silent >> text=Alle ideeën staan op het bord');
    await A.click('[data-action=silent-close]'); await B.waitForSelector('.silent >> text=Ieder schrijft eerst voor zich');
  });
  await T('U34', 'Stille ronde: automatisch onthullen als de tijd om is', async () => {
    await A.waitForSelector('[data-action=silent-start]'); await A.click('[data-action=silent-start][data-min="5"]'); await A.fill('#idea-text', 'Idee bij afloop timer'); await A.keyboard.press('Enter');
    await A.waitForSelector('.silent .badge >> text=Bastiaan: 1');
    // tijd laten verlopen: eindtijd in het verleden zetten via de gedeelde opslag
    await A.evaluate(() => { const db = JSON.parse(localStorage.getItem('mockdb')); for (const [k, v] of Object.entries(db)) if (k.startsWith('boards/') && v.silentRound && !v.silentRound.revealed) { const t = new Date(Date.now() - 1000).toISOString(); v.silentRound.endsAt = t; v.timer = { endsAt: t, minutes: 5 }; } localStorage.setItem('mockdb', JSON.stringify(db)); new BroadcastChannel('mock').postMessage('db'); });
    await A.reload(); await A.waitForSelector('.card >> text=Idee bij afloop timer', { timeout: 6000 });
    await A.click('[data-action=silent-close]');
  });
  await T('U35', 'Kans uitwerken: velden, aanzet van Claude, besluit', async () => {
    await A.click('[data-action=home]'); await A.click('.opp [data-action=open-opp]'); await A.waitForSelector('.drawer');
    await A.fill('#cv-probleem', 'Klanten weten niet welk platform past.'); await A.press('#cv-probleem', 'Tab');
    await A.click('[data-action=ai-canvas]'); await A.waitForFunction(() => document.querySelector('#cv-experiment')?.value.includes('Vijf gesprekken'), null, { timeout: 5000 });
    if ((await A.inputValue('#cv-probleem')) !== 'Klanten weten niet welk platform past.') throw new Error('Claude overschreef een ingevuld veld');
    await A.click('[data-action=opp-decision][data-key=doorgaan]');
    await B.click('[data-action=home]'); await B.waitForSelector('.opp .decision.doorgaan', { timeout: 4000 });
    const prog = await B.textContent('.opp .progress'); if (!prog.startsWith('6/')) throw new Error('voortgang ' + prog);
  });
  await T('U36', 'Toegankelijkheid van het uitwerkpaneel (axe)', async () => {
    await A.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
    const v = await A.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((x) => x.id));
    await A.keyboard.press('Escape');
    if (v.length) throw new Error(v.join(', '));
  });
  rec('U27', 'Geen JavaScript-fouten tijdens de test', errors.length ? 'FAIL' : 'PASS', errors.slice(0, 3).join(' | '));
  fs.writeFileSync(__dirname + '/resultaten.json', JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
