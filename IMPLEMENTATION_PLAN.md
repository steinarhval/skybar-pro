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

## Leveranse
- Lagring av undervisningsopplegg per owner
- Mulighet for deling
- Eksport av aggregert data
- Respektere `saveResults`

## Test
- Programmer lagres per bruker
- Eksport gir korrekt datasett
- Ingen personidentifiserbar lagring

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