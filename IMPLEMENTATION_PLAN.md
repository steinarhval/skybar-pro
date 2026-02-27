# IMPLEMENTATION_PLAN.md  
Undervisningssystem v2 – Implementeringsplan

Dette dokumentet beskriver rekkefølgen systemet bygges i.  
Det følger ARCHITECTURE.md.  
Ingen nye features implementeres før underliggende steg er fullført og testet.

---

# Oversikt

Systemet bygges stegvis i følgende rekkefølge:

1. Steg 0 – Grunnmur (Auth + Session + State-init)
2. Steg 1 – Controller lease
3. Steg 2 – Join og routing
4. Steg 3 – Vote-lock grunnmur
5. Steg 4 – Aggregator (Cloud Function)
6. Steg 5 – Display
7. Steg 6 – Controller UI
8. Steg 7 – Programs og eksport

---

# Steg 0 – Grunnmur

## Formål
Etablere korrekt Firestore-struktur i henhold til ARCHITECTURE.md.

## Leveranse
- Auth (Google)
- Start/replace session
- Opprette:
  - `sessions/{sessionId}`
  - `owners/{ownerId}`
  - `joinCodes/{joinCode}`
  - `sessions/{sessionId}/state/live`

## Test (må være grønn før videre arbeid)
- Kan logge inn
- Ny session opprettes korrekt
- Forrige session settes `ended`
- Gammel joinCode settes `active: false`
- Refresh skriver ingenting automatisk

---

# Steg 1 – Controller lease

## Formål
Hindre at to controllere skriver samtidig.

## Standardvalg
- Lease TTL: 60 sek

## Leveranse
- Controller-write setter:
  - `controllerId`
  - `controllerTs`
  - `controllerLeaseUntil`
- Vise lease-status i controller UI
- Ingen takeover-dialog ennå

## Test
- Lease oppdateres ved state-write
- Refresh gjør ingen writes
- To nettlesere kan se hvem som har lease

---

# Steg 2 – Join og routing

## Formål
Koble deltakere til aktiv session.

## Standardvalg
- JoinCode: 6 tegn (A–Z/0–9), tilfeldig generert
- Kollisjonssjekk før opprettelse

## Leveranse
- `join.html`
- `innhenting.html` (kun kobling til session)
- Sjekk `joinCodes/{joinCode}.active == true`

## Test
- Ugyldig kode avvises
- Gyldig kode kobler til riktig session
- State kan leses, men ikke skrives

---

# Steg 3 – Vote-lock grunnmur

## Formål
Hindre dobbelstemming og “stemme igjen ved refresh”.

## Leveranse
- Generer `participantClientId` i localStorage
- Stem lagres i:
  `sessions/{sessionId}/rounds/{roundId}/votes/{clientId}`
- Hvis vote-doc finnes → UI låses

## Test
- Én stemme per clientId per roundId
- Refresh låser fortsatt
- Ny roundId åpner igjen

---

# Steg 4 – Aggregator (Cloud Function)

## Formål
Aggregere resultater server-side.

## Leveranse
- Cloud Function: onVoteCreated
- Oppdater:
  `sessions/{sessionId}/rounds/{roundId}/agg`

## Aggregert struktur
- multi: counts per alternativ + n
- likert: sum + count (+ histogram senere)
- open: liste tekster
- wordcloud: frekvens per ord

## Test
- Agg oppdateres korrekt ved nye stemmer
- Display trenger ikke lese rå votes

---

# Steg 5 – Display

## Formål
Ren visningsskjerm uten skrive-rettigheter.

## Leveranse
- `display.html`
- Leser:
  - `state/live`
  - `rounds/{roundId}/agg`

## Test
- Oppdaterer live
- Skriver ingenting til Firestore

---

# Steg 6 – Controller UI

## Formål
Full styring av spørsmål og status.

## Leveranse
- Velge spørsmål
- Sette:
  - mode
  - question
  - status
- Knapper:
  - Collect
  - Results
  - Reset (ny roundId)
  - End session

## Test
- Reset påvirker kun aktiv roundId
- Ingen smitte mellom spørsmål
- Lease beskytter state

---

# Steg 7 – Programs og eksport

## Formål
Gjøre undervisningsopplegg gjenbrukbare per foreleser, med kontrollert deling og eksport av aggregert data.

Steg 7 skal ikke endre eksisterende avstemningsmotor (Steg 0–6).
Ingen nye modes, ingen design-endringer, ingen sideeffekter.

---

## Fase 7.1 – Datamodell (Programs)

### Leveranse
- Innføre `programs/{programId}` i henhold til ARCHITECTURE.md (punkt 4.5).
- Program inneholder aldri personidentifiserbare data.
- Ingen writes til `sessions/*` eller `state/live` i denne fasen.

### Test (må være grønn før 7.2)
- Kan opprette et program (eksplisitt handling).
- Kan lese eget program.
- Refresh gjør ingen writes.
- `state/live` endres ikke som bieffekt.

---

## Fase 7.2 – Rules (RBAC for Programs)

### Leveranse
- Kun eier (ownerId) eller admin kan oppdatere/slette et program.
- Deling gir kun lesetilgang (read-only) for andre.
- Instruktør kan ikke skrive til andres programmer.

### Test (må være grønn før 7.3)
- Update/delete av andres program avvises av rules.
- Read fungerer for shared/library uten at write er mulig.

---

## Fase 7.3 – Controller CRUD (program-lagring)

### Leveranse
- Lage nytt program (eksplisitt knapp/handling).
- Lagre/oppdatere program (eksplisitt knapp/handling).
- Slette eget program.
- Liste programmer i controller:
  - Egne (ownerId == meg)
  - Shared (delt med meg, read-only)
  - Library (felles bibliotek, read-only)

### Test (må være grønn før 7.4)
- Ingen auto-write ved refresh.
- Ingen write uten eksplisitt handling.
- Liste/åpne program er read-only.

---

## Fase 7.4 – Copy-to-own (Lag kopi)

### Leveranse
- Foreleser som kan lese et program (shared/library) kan lage kopi til egen konto.
- Kopi opprettes som nytt program med:
  - nytt programId
  - ownerId = request.auth.uid (kopiens eier)
  - visibility = "private" (default)
  - sourceProgramId = originalens programId (skal støttes)
- Kopi er uavhengig av original.

### Test (må være grønn før 7.5)
- Endringer i kopi påvirker ikke original.
- Kopi kan redigeres av kopiens eier selv om original er read-only.

---

## Fase 7.5 – Koble program til aktiv session

### Leveranse
- Eksplisitt handling i controller: “Bruk i aktiv session”.
- Oppdaterer kun `sessions/{sessionId}.programId`.
- Kun session-eier (ownerId) eller admin kan sette `programId` for sessionen.
- Handlingen skal ikke:
  - endre `state/live`
  - opprette rounds/votes/agg
  - trigge auto-writes ved refresh

### Test (må være grønn før 7.6)
- `sessions/{sessionId}.programId` settes korrekt.
- Ingen andre Firestore-writes skjer.
- Refresh gjør ingen writes.

---

## Fase 7.6 – Eksport (kun aggregert JSON)

### Standard (låst)
- Hvis `saveResults = false` skal eksport ikke være mulig.

### Leveranse
- Eksport av aggregert data til JSON for en session, kun for session-eier/admin.
- Eksport kan kun inkludere:
  - `sessions/{sessionId}` relevante metadata
  - `sessions/{sessionId}/rounds/{roundId}/agg/live` (aggregert)
- Eksport skal aldri inkludere:
  - `votes/*`
  - personidentifiserbar data

### Test (må være grønn før Steg 7 er ferdig)
- Når `saveResults=false`: eksport er blokkert (UI deaktiverer/skjuler, og logikk håndhever).
- Når `saveResults=true`: eksport genererer JSON som kun inneholder metadata + agg/live per round.
- Ingen votes kan eksporteres eller leses som del av eksportflyten.

---

## Låseprinsipp for Steg 7
- Hver fase (7.1–7.6) må være grønn før neste påbegynnes.
- Ingen avvik fra ARCHITECTURE.md.
- Ingen nye collections uten eksplisitt beslutning.
- Ingen auto-writes ved refresh.
- Ingen svar-data i state.
- Eksport er kun aggregert.

---

# Låseprinsipper

Før neste steg påbegynnes:

- Alle tester i gjeldende steg må være grønne
- Ingen midlertidige hacks
- Ingen avvik fra ARCHITECTURE.md
- Ingen ekstra features

---

Dette dokumentet kan justeres ved behov.  

ARCHITECTURE.md er systemets faste kontrakt.
