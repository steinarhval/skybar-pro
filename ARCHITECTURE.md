# Skybar Pro – arkitektur

Oppdatert 24. november 2026.

## 1. Formål

Skybar Pro er et nettbasert live-verktøy for undervisning: foreleseren styrer spørsmål, deltakerne svarer via mobil, og aggregerte resultater vises på plenumsskjerm. Multi (flervalg) er hovedmodus.

## 2. Prinsipper

- Fungerende kode er fasit; stabilitet fremfor nye funksjoner.
- Enkelt fremfor avansert. Live-bruk fremfor historikk.
- Minimer datalagring og unngå innsamling av identifiserende opplysninger fra deltakerne. Tekniske klient-ID-er og eventuell fritekst må likevel behandles med omtanke.
- Konservative, små, testbare endringer.

## 3. Roller

- `kontroll.html`: foreleser logger inn, starter og avslutter sesjon, velger modus og spørsmål, starter runder og styrer collect/results/reset.
- `display.html`: viser spørsmål, QR-kode/join-kode, antall svar og aggregerte resultater; ingen kontrollfunksjoner.
- `innhenting.html`: deltakere svarer via mobil; én stemme per clientId per runde.
- `join.html`: alternativ inngang via manuell join-kode.

## 4. Kjerneflyt

1. Start sesjon og generer joinCode.
2. Deltakerne kobler seg til via QR-kode eller join-kode.
3. Velg spørsmål og modus, start runde med ny roundId.
4. Samle inn svar (collect).
5. Vis eller skjul resultater (results/collect).
6. Start ny runde eller avslutt sesjonen.

## 5. Firestore-struktur (eksisterende)

- `owners/{ownerId}`: activeSessionId, activeJoinCode.
- `joinCodes/{joinCode}`: sessionId, ownerId, active.
- `sessions/{sessionId}`: eier, status, tidsstempler og eksisterende metadata (saveResults, programId). Sistnevnte er ikke nødvendige for live-bruk og er kandidater for fjerning.
- `sessions/{sessionId}/state/live`: status, mode, roundId, question, controllerId, controllerLeaseUntil.
- `sessions/{sessionId}/rounds/{roundId}/votes/{clientId}`: value, mode, createdAt.
- `sessions/{sessionId}/rounds/{roundId}/agg/live`: n og modusavhengige counts, sum/count, texts eller freq.

## 6. Viktige mekanismer

- Vote-lock: Firestore-transaksjon sikrer én stemme per klient-ID per runde.
- Controller lease: hindrer konflikt mellom kontrollere.
- Reconnect: klientene kan koble seg til igjen.
- Serverbasert opptelling: Cloud Function `onVoteCreated` aggregerer stemmer; display leser resultatdokumentet. Klientene skal ikke selv skrive aggregater.
- Firestore Rules beskytter tilgang og skriveoperasjoner.
- Tekniske ID-er og diagnostikk beholdes.

## 7. Moduser

Multi er hovedprioritet. Eksisterende likert, open og wordcloud beholdes så lenge de ikke skaper konkrete problemer. Ingen nye moduser planlegges.

## 8. UI og styling

Display skal være rent og tydelig; kontrollpanelet funksjonelt; innhenting enkel og mobilvennlig. Statisk styling i app.css, HTML for struktur, JavaScript for logikk. Inline-stil kun ved behov, eksempelvis dynamiske søyler.

## 9. Dataprinsipper

**Mål:** Stemmer og resultater skal kun beholdes så lenge de trengs for live-bruk. Ingen permanent historikk eller resultatarkiv.

**Dagens status:** Avslutning og ny runde sletter ikke tidligere data. Automatisk sletting er ikke implementert. saveResults er metadata og styrer ikke sletting.

**Plan:** Etabler sikker opprydding av utløpte runder, avsluttede sesjoner, tilhørende underliggende dokumenter og join-koder. Avklar oppbevaringstid før implementering. Bevar aktiv sesjon, vote-lock og reconnect; håndter forsinkede funksjonshendelser slik at slettede data ikke gjenopprettes.

## 10. Drift

Firebase-prosjekt skybar-pro med Cloud Firestore, Authentication og Cloud Functions. Brukerflatene brukes via GitHub Pages; eksisterende GitHub Actions deployer også Firebase Hosting, Functions og Rules. Blaze med aktiv fakturering er nødvendig for eksisterende Cloud Functions-arkitektur. Overvåk kostnader; budsjettvarsler er ikke kostnadstak.

24. november 2026: Live-opptelling gjenopprettet etter reaktivering av fakturering og overgang fra Spark til Blaze, uten kodeendring.

## 11. Avgrensning

Steg 7 er skrinlagt: ingen programbibliotek, lagring/gjenbruk av spørsmålssett, deling av opplegg, eksport eller resultathistorikk. Nye funksjoner krever konkret behov. Teknisk midlertidig lagring er fortsatt nødvendig for live-innsamling.
