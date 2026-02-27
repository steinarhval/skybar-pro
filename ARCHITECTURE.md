# ARCHITECTURE.md  
Undervisningssystem v2 – Grunnlov

Dette dokumentet definerer de faste prinsippene for systemet.  
All implementasjon skal følge denne kontrakten.  
Ingen avvik uten eksplisitt beslutning.

---

# 1. Formål

Systemet er en session-basert undervisningsplattform med tre roller:

- **Controller** (foreleser)
- **Display** (plenumsskjerm)
- **Deltaker** (mobil)

Systemet skal være robust, forutsigbart og uten sideeffekter mellom spørsmål.

---

# 2. Modus (kun 4)

Systemet støtter kun følgende modus:

- `multi`
- `likert`
- `open`
- `wordcloud`

---

# 3. Datamodell – Hovedprinsipp

## Session og State er separate konsepter.

### Session = metadata og historikk  
### State = styringskilde (live kontroll)

State skal **aldri inneholde svar**.

---

# 4. Firestore-struktur

## 4.1 Owner-peker (én aktiv session per konto)


owners/{ownerId}


Felter:
- activeSessionId
- activeJoinCode
- updatedAt

Det kan kun finnes én aktiv session per owner.

---

## 4.2 JoinCode-routing


joinCodes/{joinCode}


Felter:
- sessionId
- ownerId
- createdAt
- active (true/false)

Når ny session startes:
- gammel joinCode settes `active: false`

---

## 4.3 Session-metadata (historikk)


sessions/{sessionId}


Felter:
- sessionId
- ownerId
- status: "active" | "ended"
- startedAt
- endedAt
- updatedAt
- joinCode
- saveResults (true/false)
- programId (kan være null)

Session-dokumentet inneholder aldri svar.

---

## 4.4 State (styringskilde)


sessions/{sessionId}/state/live


Felter:
- sessionId
- status: "idle" | "collect" | "results" | "paused"
- mode
- roundId
- question
- controllerId
- controllerLeaseUntil
- controllerTs

State inneholder aldri svar-data.
State-dokumentet finnes kun for aktiv session.

---
## 4.5 Programs (undervisningsopplegg) 
programs/{programId} 

Felter:

- ownerId
- title
- content (spørsmål/struktur)
- visibility: "private" | "shared" | "library"
- createdAt
- updatedAt
- sourceProgramId (kan være null)

Regler:

Program inneholder aldri personidentifiserbare data.
Kun eier (ownerId) eller admin kan endre/slette et program.
Deling gir lesetilgang, ikke redigeringsrett.
Kopi (copy-to-own) opprettes som nytt program med ny ownerId.

---

# 5. Roller og skrive-rettigheter

- Controller kan skrive til state.
- Display kan kun lese state og aggregert resultatdata.
- Deltaker kan aldri skrive til state.
- Deltaker kan kun skrive til votes-path under session.
- Controller kan kun skrive til state for aktiv session.
- “Controller” betyr eier av aktiv session (ownerId).
- Kun session-eier (ownerId) eller admin kan skrive til sessions/{sessionId} og state/live.

---

# 6. Vote-lock prinsipp

Én stemme per:
- clientId
- roundId

Vote-lock implementeres via:


sessions/{sessionId}/rounds/{roundId}/votes/{clientId}


Reset skjer ved ny `roundId`.

Reset sletter aldri hele session.
Reset gjelder kun aktiv round.

---

# 7. Reset-semantikk

- Reset påvirker kun aktiv `roundId`
- Reset skal aldri nullstille hele opplegget
- Reset skal aldri påvirke tidligere spørsmål
- Reset skjer ved generering av ny `roundId`
- Reset genererer alltid ny `roundId` før ny innsamling starter.

---

# 8. SaveResults-policy

Ved session start settes:


saveResults: true | false


Hvis `saveResults = false`:
- Data kan slettes ved session-end.

Hvis `true`:
- Data beholdes for eksport.


---

# 9. Controller lease

Controller har en tidsbegrenset lease:

- controllerLeaseUntil settes ved controller-write
- Lease håndheves ikke automatisk uten eksplisitt takeover-logikk
- Manuell overtakelse skal kreve eksplisitt bekreftelse

---

# 10. Stil og UI-regler

- All stil defineres i CSS.
- Ingen inline styles i HTML.
- Ingen dynamisk styling direkte i JS (kun class-toggling).
- CSS er eneste kilde til layout, farger, fonter og effekter.

---

# 11. Replace-semantikk

Når ny session startes:

1. Forrige session settes til `status: "ended"`
2. Ny session opprettes
3. Owner-peker oppdateres
4. State initialiseres på nytt
5. Gammel joinCode settes `active: false`

Historikk slettes ikke automatisk.

---

# 12. Ikke tillatt

- Ingen svar-data i state
- Ingen global nullstilling av hele opplegg
- Ingen midlertidige hacks
- Ingen automatisk skrivning ved refresh
- Ingen implisitt sideeffekt mellom modus
- Ingen eksport eller uthenting av votes-data (kun aggregert eksport er tillatt).

---

# 13. Endringer i grunnloven

Endringer i denne filen skal:

- være eksplisitte
- begrunnes
- versjoneres i Git
- godkjennes før implementasjon

---

Dette dokumentet er systemets fundament.
Implementasjonsplaner kan endres.

Grunnloven skal være stabil.


