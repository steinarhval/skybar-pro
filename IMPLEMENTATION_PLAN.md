# IMPLEMENTATION_PLAN.md – Undervisningssystem V2 (v1)

## Status

Steg 0–6 er ferdig implementert og fungerer stabilt.

Fokus nå:
- stabilitet
- enkelhet
- UI/UX
- visning

---

## Ferdige steg

### Steg 0–2
- Firebase setup
- Session struktur
- JoinCode-system

### Steg 3–4
- State/live
- Kontroll → display → innhenting flyt

### Steg 5
- Vote-lock (transaction-basert)

### Steg 6
- Aggregator (Cloud Function)
- multi / likert / open / wordcloud

---

## Nåværende fokus (v1)

Videre arbeid skal være:

### 1. UI-forbedringer
- display (plenum)
- innhenting (mobil)
- kontroll (operatør)

### 2. Multi-modus (hovedprioritet)
- visning
- tydelighet
- pedagogisk effekt

### 3. Stabilitet
- reconnect
- vote-lock
- lease

---

## Arbeidsform

- små steg
- én endring om gangen
- alltid test etter endring
- ikke refactor for moro skyld
- ikke rør fungerende logikk

---

## Prioriterte forbedringsområder

1. Display:
   - bedre layout
   - tydelig status
   - bedre visning av resultater

2. Innhenting:
   - tydeligere tilbakemeldinger
   - bedre mobilopplevelse

3. Kontroll:
   - klarere status
   - bedre flyt

---

## Ikke prioritert nå

- ytelsesoptimalisering (systemet er raskt nok)
- nye datamodeller
- avansert logging
- eksport

---

## Steg 7 (utsatt)

Steg 7 er satt på pause:

- programs collection
- deling
- eksport

Dette skal ikke implementeres nå.

---

## Videre strategi

Når v1 er stabil:

- evaluer behov for steg 7
- vurder enkel implementasjon
- unngå kompleksitet

---

## Mål

Et stabilt, enkelt og godt undervisningsverktøy som fungerer hver gang.
