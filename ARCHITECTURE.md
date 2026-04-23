# ARCHITECTURE.md – Undervisningssystem V2 (v1)

## 1. Formål

Dette systemet er en live undervisningsrigg for:

- sanntids spørsmål
- deltakerrespons via mobil
- visning av aggregert resultat på plenumsskjerm

Systemet er laget for enkel, stabil bruk i undervisning.

---

## 2. Prinsipper

- Fungerende kode er fasit
- Enkelt > avansert
- Live-bruk > fremtidige features
- Ingen unødvendig lagring
- Ingen personidentifiserbare data
- Konservativ utvikling

---

## 3. Roller

Systemet har tre tydelige roller:

### kontroll.html
- Operatør (foreleser)
- Starter session
- Setter spørsmål og modus
- Styrer collect / results / reset

### display.html
- Publikumsskjerm
- Viser spørsmål og resultater
- Ingen kontrollfunksjoner

### innhenting.html
- Deltaker (mobil)
- Avgir svar
- Én stemme per runde (vote-lock)

---

## 4. Kjerneflyt

1. Start session
2. Generer joinCode
3. Deltakere kobler seg på
4. Sett spørsmål + modus
5. Start runde (roundId)
6. Samle svar (collect)
7. Vis resultater (results)
8. Reset → ny runde

---

## 5. Firestore-struktur

### owners/{ownerId}
- activeSessionId
- activeJoinCode

### joinCodes/{joinCode}
- sessionId
- ownerId
- active

### sessions/{sessionId}
- ownerId
- createdAt
- status
- saveResults (ikke brukt aktivt i v1)

#### state/live
- status (idle / collect / results / paused)
- mode (multi / likert / open / wordcloud)
- roundId
- question
- controllerId
- controllerLeaseUntil

#### rounds/{roundId}

##### votes/{clientId}
- value
- mode
- createdAt

##### agg/live
- n
- counts / sum / texts / freq

---

## 6. Viktige mekanismer

### Vote-lock
- 1 stemme per clientId per roundId
- håndheves med Firestore transaction

### Controller lease
- hindrer konflikt mellom kontrollere
- kun én aktiv controller

### Reconnect
- deltaker husker session lokalt
- display og innhenting kan koble seg på igjen

---

## 7. Modus

### multi (prioritert)
- valg med søylediagram
- tydelig visuell feedback

### likert
- numerisk verdi

### open
- tekstliste

### wordcloud
- ord-frekvens

---

## 8. UI-prinsipper

- display = ren og tydelig
- kontroll = teknisk og funksjonell
- innhenting = mobil, enkel, tydelig

---

## 9. Styling-regler

- All statisk styling i `app.css`
- HTML = struktur
- JS = logikk
- Inline style kun når nødvendig (f.eks. dynamisk høyde på søyler)

---

## 10. Dataprinsipper

- Ingen lagring etter session er nødvendig
- Data lever kun i aktiv session
- Aggregering skjer via Cloud Function

---

## 11. Avgrensning (v1)

Systemet inkluderer ikke:

- programbibliotek
- deling av opplegg
- eksport
- historikk

---

## 12. Steg 7 (utsatt)

Steg 7 omfatter:

- lagring av opplegg (programs)
- deling
- eksport

Dette er **utsatt** og ikke del av v1.

Det skal ikke påvirke nåværende arkitekturvalg.
