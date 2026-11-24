# Skybar Pro

Et enkelt nettbasert live-verktøy for undervisning. Foreleseren styrer spørsmål fra `kontroll.html`, deltakerne svarer via `innhenting.html` etter å ha skannet QR-kode, og resultater vises i plenum med `display.html`. Manuell tilkobling er tilgjengelig via `join.html`.

Flervalg (multi) er hovedmodus. Systemet støtter også likert, åpne svar og ordsky.

Løsningen bruker Firebase Authentication, Cloud Firestore og Cloud Functions for serverbasert opptelling. Eksisterende backend krever aktiv Blaze-fakturering.

Målet er stabil live-innsamling, ikke historikk, eksport eller programbibliotek. Automatisk sletting av gamle svar er planlagt, men ikke implementert.

Se [arkitekturen](ARCHITECTURE.md) og [vedlikeholdsplanen](IMPLEMENTATION_PLAN.md).
