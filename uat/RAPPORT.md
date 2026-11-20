# UAT-rapport Brainstorm

- **Versie:** artifact versie 3
- **Datum:** 19 november 2026
- **Getest:** `artifact/brainstorm.html`, in een nagebootste claude.ai-omgeving

## Hoe getest

De scenario's zijn geschreven vanuit het gebruik door het partnerteam. Ze zijn geautomatiseerd doorlopen in Chromium met meerdere gebruikers tegelijk, elk in een eigen tabblad. Die gebruikers waren:

- vier partners met elk een rol;
- een vijfde persoon zonder rol;
- iemand met alleen leesrechten.

**Wat is nagebootst:**

- de gedeelde opslag van claude.ai;
- de identiteiten van de gebruikers;
- live aanwezigheid;
- Claude zelf, met vaste antwoorden.

**Wat niet is getest:**

- het echte claude.ai met echte accounts;
- echte antwoorden van Claude;
- een schermlezer.

Toegankelijkheid is automatisch gecontroleerd met axe-core op WCAG 2.2 AA.

Opnieuw draaien: `./uat/run.sh`. Je hebt Playwright en `npm install` nodig.

## Resultaat

| Ronde | Geslaagd | Werkt, kan beter | Gefaald |
| --- | --- | --- | --- |
| Uitgangssituatie (versie 2) | 16 | 8 | 2 |
| Na verbeteringen (versie 3) | 27 van 27 | 0 | 0 |

## Bevindingen en wat er is gedaan

| # | Bevinding | Ernst | Oplossing |
| --- | --- | --- | --- |
| U21 | Zijn alle vier de rollen bezet, dan kan een vijfde persoon nergens heen | Blokkerend | Knop **Meedoen zonder rol**: ideeën toevoegen, stemmen en reageren kan zonder rol |
| U22 | Iemand met alleen leesrechten blijft hangen op de rolkeuze en ziet niets | Blokkerend | Wie alleen kan lezen, slaat de rolkeuze over en kijkt direct mee |
| U14 | Typen twee mensen tegelijk in de notities, dan overschrijft de een de ander zonder waarschuwing | Hoog | Je ziet wie er ook typt. Komt er tijdens het typen een wijziging binnen, dan krijg je een melding en kies je bij het opslaan: beide bewaren, alleen jouw versie of alleen die van de ander |
| U27 | Een focuswissel kon tijdens het bijwerken van de pagina een tweede bijwerkronde starten, met een fout in het tweede tabblad als gevolg | Hoog | Het bijwerken van de pagina kan niet meer dubbel tegelijk lopen |
| U04 | Tekst boven 280 tekens werd bij opslaan ongemerkt afgekapt | Middel | Maximale lengte op alle velden, met een teller bij het idee |
| U08 | Een idee op de shortlist zetten kon alleen via het detailpaneel | Middel | Ster op elke ideekaart |
| U13 | Eigenaar en deadline van een actie waren na aanmaken niet te wijzigen | Middel | Direct aan te passen in de actielijst |
| U11 | Een geplaatste reactie (bijvoorbeeld met een typfout) was niet te verwijderen | Laag | Verwijderknop bij je eigen reacties |
| U12 | Zonder scores was de prioriteringsmatrix leeg, zonder uitleg | Laag | De lege matrix legt uit wat je moet doen |
| U17 | Zoeken op tekst ontbrak; lastig bij veel ideeën | Laag | Zoekveld, met "x van y ideeën zichtbaar" en een knop om filters te wissen |
| U19 | De beschrijving van een kans op de kansenradar was niet te bewerken | Laag | Knop **Beschrijving bewerken** op elke kans |

## Scenario's

| # | Scenario | Resultaat |
| --- | --- | --- |
| U01 | Eerste bezoek: rol kiezen en uitleg zien | Geslaagd |
| U02 | Sessie starten vanuit een sjabloon met een eigen vraag | Geslaagd |
| U03 | Ideeën toevoegen met Enter; een leeg idee geeft een hint | Geslaagd |
| U04 | Een lang idee wordt niet ongemerkt afgekapt | Geslaagd |
| U05 | Thema toevoegen, hernoemen en verwijderen | Geslaagd |
| U06 | Tweede partner ziet alles live; eigen typwerk blijft staan | Geslaagd |
| U07 | Stemmen: maximaal 5, terugnemen kan | Geslaagd |
| U08 | Idee op de shortlist zetten zonder het te openen | Geslaagd |
| U09 | Idee bewerken in het detailpaneel: tekst, toelichting, thema, shortlist | Geslaagd |
| U10 | Perspectief geven; de rol van een ander is niet te bewerken | Geslaagd |
| U11 | Reactie plaatsen en eigen reactie verwijderen | Geslaagd |
| U12 | Prioriteren: lege matrix legt uit wat te doen; scores tonen een punt | Geslaagd |
| U13 | Besluit en actie vastleggen; eigenaar en deadline later aanpassen | Geslaagd |
| U14 | Notities: gelijktijdig typen overschrijft elkaar niet ongemerkt | Geslaagd |
| U15 | Claude: ideeën genereren, accepteren, negeren | Geslaagd |
| U16 | Claude: advocaat van de duivel, extra perspectieven, samenvatting, vraag | Geslaagd |
| U17 | Zoeken en filteren in ideeën | Geslaagd |
| U18 | Timebox starten en stoppen, zichtbaar bij de partner | Geslaagd |
| U19 | Idee naar de kansenradar, fase wijzigen, beschrijving aanvullen | Geslaagd |
| U20 | Export: Markdown downloaden | Geslaagd |
| U21 | Vijfde persoon (alle rollen bezet) kan meedoen | Geslaagd |
| U22 | Gebruiker met alleen leesrechten kan meekijken | Geslaagd |
| U23 | Sessie archiveren en terughalen | Geslaagd |
| U24 | Mobiel (390 px): bord bruikbaar, geen zijwaarts scrollen | Geslaagd |
| U25 | Sessie verwijderen met bevestiging | Geslaagd |
| U26 | Toegankelijkheid (axe, WCAG 2.2 AA) op bord en startpagina | Geslaagd |
| U27 | Geen JavaScript-fouten tijdens de test | Geslaagd |

## Nog te doen in het echt

1. **Tweede account:** de eerste partner laten inloggen via de deelknop, een rol laten kiezen en samen één sessie doorlopen. Dit test echte accounts, echte rechten en de echte live-updates.
2. **Claude:** één keer Claude laten meedenken en beoordelen of de ideeën en kritische vragen inhoudelijk bruikbaar zijn.
3. **Schermlezer:** een korte proef met een schermlezer (VoiceOver of NVDA). Die stap kan geen automatische scan vervangen.

## Update versie 4: inchecken als persoon

Geen rollen meer: je checkt in als Mart, Joey, Timon of Bastiaan, of je doet mee als gast. In de app staan alleen voornamen. Iedereen houdt zijn eigen expertise bij, en Claude gebruikt die bij ideeën, kritische vragen en samenvattingen. Bij een voorgesteld idee staat bij wie het het beste past. De drie extra perspectieven heten nu **toetsen**: klantwaarde, commercie, en risico & compliance.

Scenario's aangepast en toegevoegd: U28 (alleen voornamen), U29 (expertise invullen, alleen je eigen kaart), U30 (Claude krijgt de expertise mee). Resultaat: **30 van 30 geslaagd**.

Nieuwe bevinding, opgelost: na het terugzetten van een gearchiveerde sessie bleef de startpagina het lege archief tonen. Bij het openen van een sessie keert de weergave nu terug naar de actieve sessies.

## Update versie 5: nieuw sinds je laatste bezoek, stille ronde, kans uitwerken

**Nieuw sinds je laatste bezoek.** De startpagina toont per sessie een label "x nieuw" en een overzicht van wat anderen deden sinds je vorige bezoek. Klik je op een regel, dan ga je direct naar dat idee. In een sessie staat bovenaan een balk met wat er nieuw is, met de knoppen "Alleen nieuwe tonen" en "Gelezen". Nieuwe kaarten en reacties zijn gemarkeerd. Je gelezen-status is privé: alleen jij kunt hem lezen.

**Stille ronde.** Ieder schrijft voor zich; de ideeën blijven privé. Je ziet alleen hoeveel ideeën ieder klaar heeft. Na de onthulling, met de knop of automatisch als de tijd om is, komen alle ideeën tegelijk op het bord. Wie op dat moment niet online is, deelt zijn ideeën zodra hij de app opent.

**Kans uitwerken.** Elke kans op de radar heeft een uitwerking met zeven velden: probleem, klant, waardepropositie, verdienmodel, belangrijkste aanname, experiment en resultaat. Daarnaast leg je een besluit vast: doorgaan, bijsturen of stoppen. Claude vult op verzoek alleen de lege velden in en laat wat er al staat met rust. De kaart toont de voortgang en het besluit.

Nieuwe scenario's U31 tot en met U36. Resultaat: **36 van 36 geslaagd**, twee keer achter elkaar.

Gevonden en opgelost tijdens het testen: typte je direct na het starten van een stille ronde een idee, dan kon dat nog openbaar worden geplaatst, omdat je scherm de ronde nog niet kende. De ronde geldt nu direct op je eigen scherm.

Niet nagebootst en dus in het echt te controleren: dat de privé-ideeën van een stille ronde echt alleen voor de schrijver leesbaar zijn. Dit is de standaardinstelling van de opslag van claude.ai voor `data/users/<id>/`. De test kan alleen nagaan dat de app nooit de ideeën van een ander opvraagt.
