# 💡 Brainstorm

Een realtime brainstorm- en sparringapp voor ons partnerteam. We komen allemaal uit de ServiceNow-wereld, maar we hebben elk een andere expertise. De app zet die vier perspectieven bewust naast elkaar, zodat we samen verder kunnen kijken dan ons huidige vakgebied.

| Rol | Bril |
| --- | --- |
| Enterprise Architect | Landschap & strategie |
| Product Manager | Klantwaarde & markt |
| HR / Business Lead | Mensen, organisatie & business case |
| Solution Architect | Haalbaarheid & oplossing |

## Wat kun je ermee?

- **Sessies met werkvormen**: *Horizon verbreden*, *Nieuwe propositie*, *Ons samenwerkingsmodel*, *Pre-mortem* of een vrije brainstorm. Elke werkvorm begint met een centrale vraag en een set thema's.
- **Vijf fasen**: verkennen → ideeën genereren → perspectieven → prioriteren → besluiten. Met een gedeelde timebox-timer.
- **Ideeënbord**: ideeën per thema, met het perspectief waaruit ze komen, dot-voting (5 stemmen per persoon) en opmerkingen.
- **Perspectievenmatrix**: elke partner geeft per idee op de shortlist een oordeel vanuit de eigen rol (👍 kans / neutraal / ⚠️ zorg). Zo zie je in één oogopslag waar de rollen het eens zijn en waar ze botsen.
- **Prioriteren**: iedereen scoort impact en inspanning. Een 2×2-matrix (quick wins, grote projecten, opvullers, tijdvreters) en een ranglijst laten het resultaat zien.
- **Besluiten, acties & notities**: met een eigenaar en een deadline.
- **Kansenradar**: de beste ideeën uit alle sessies op één kanbanbord (verkennen → valideren → bouwen → geparkeerd).
- **AI-sparringpartner** (optioneel, via Claude):
  - stelt nieuwe ideeën voor vanuit alle vier de rollen, ook buiten ServiceNow;
  - speelt *advocaat van de duivel* op een idee, met risico's, aannames en een klein experiment;
  - vat de sessie samen;
  - beantwoordt vragen in een gesprek dat het hele team ziet.
- **Realtime**: je ziet wie er online is en wie er in een sessie zit. Wijzigingen verschijnen direct bij iedereen.
- **Export** van een sessie naar Markdown, handig voor Confluence, Notion of e-mail.

## Snel starten

Je hebt Node.js 20 of nieuwer nodig.

```bash
npm install
cp .env.example .env        # pas TEAM_CODE en de namen aan
node --env-file=.env server/index.js
```

Open daarna <http://localhost:3000>, vul de teamcode in en kies wie je bent.

`npm run dev` herstart de server automatisch bij wijzigingen. `npm test` draait de tests.

### AI aanzetten

Zet `ANTHROPIC_API_KEY` in `.env`. Een sleutel maak je aan op <https://console.anthropic.com>. Standaard wordt `claude-opus-5-5` gebruikt; met `ANTHROPIC_MODEL` kies je een ander model. Zonder sleutel werkt alles, behalve de AI-functies.

Als Claude een verzoek weigert, schakelt de app automatisch over op een ander model (de server-side fallback van de API).

## Online zetten voor het team

De app is één Node-proces met één JSON-bestand als opslag. Dat is ruim genoeg voor vier mensen.

```bash
docker build -t brainstorm .
docker run -d -p 3000:3000 -v brainstorm-data:/app/data \
  -e TEAM_CODE=... -e ANTHROPIC_API_KEY=... -e COOKIE_SECURE=true \
  -e MEMBER_SA_NAME=... brainstorm
```

Dit draait op elke host die Docker en WebSockets ondersteunt, zoals Fly.io, Railway, Render, Azure Container Apps of een eigen VPS. Let op een paar dingen:

- Zet **altijd een `TEAM_CODE`** zodra de app publiek bereikbaar is.
- Zet de app achter **HTTPS** en gebruik `COOKIE_SECURE=true`.
- Koppel een **persistent volume** aan `/app/data`, anders ben je je gegevens kwijt bij een herstart.
- Maak af en toe een back-up van `data/brainstorm.json`.

## Hoe het in elkaar zit

```
server/
  index.js    HTTP-API, inloggen, WebSocket-broadcast, AI-routes
  actions.js  alle wijzigingen als acties (ideeën, stemmen, perspectieven, …)
  ai.js       Claude-integratie (ideeën, advocaat van de duivel, samenvatting, vragen)
  config.js   rollen, bijbehorende vragen, fasen en werkvormen  ← hier pas je de inhoud aan
  store.js    JSON-opslag met atomische writes
  export.js   Markdown-export
public/       frontend zonder build-stap (vanilla JS + morphdom)
test/         tests voor de actielogica en de export
```

Elke wijziging gaat als actie naar `POST /api/action`. De server past de actie toe, slaat het resultaat op en stuurt de nieuwe toestand via WebSocket naar iedereen die meekijkt.

**Inloggen** werkt met één gedeelde teamcode. Daarna kies je wie je bent. Dat past bij een klein team dat elkaar vertrouwt, maar het is geen echte gebruikersauthenticatie.

**Gelijktijdig bewerken**: als twee mensen tegelijk hetzelfde tekstveld aanpassen, zoals de sessienotities, wint de laatste opslag.

## Ideeën voor later

- Inloggen via Microsoft of Google (SSO) in plaats van een gedeelde code
- Ideeën slepen tussen thema's
- Asynchrone rondes: iedereen brainstormt eerst los, daarna wordt alles tegelijk zichtbaar
- Koppeling met Teams of Slack voor meldingen
