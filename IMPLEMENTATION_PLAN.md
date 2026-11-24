# Skybar Pro – vedlikeholdsplan

Oppdatert 24. november 2026.

## Status

Steg 0–6 er implementert: Firebase-oppsett, sesjoner, join-koder, state/live, klientflyt, vote-lock og serverbasert aggregering. Live-flervalgsfunksjonen fungerer igjen etter reaktivering av Blaze 24. november 2026. Andre moduser er ikke bekreftet retestet denne dagen.

Steg 7 (programbibliotek, deling, eksport og historikk) er skrinlagt, ikke utsatt.

## Prioritert vedlikehold

- [ ] Sikre fungerende referanseversjon (ZIP fra 28. april 2026, eventuelt Git-tag).
- [x] Utarbeide oppdatert dokumentasjon (publisering i repository gjenstår).
- [ ] Fjerne ubrukt metadata saveResults og programId etter kontroll av avhengigheter.
- [ ] Avklare kort oppbevaringstid for live-data og implementere sikker automatisk opprydding, inkludert underliggende Firestore-dokumenter og utløpte join-koder. Unngå sletting av aktive data og gjenoppretting via forsinkede hendelser.
- [ ] Rydde gamle data etter at oppryddingen er testet og sletting er godkjent.
- [ ] Gjennomgå tilgangsregler, validering av stemmer, idempotent aggregering og kostnadsrisiko.
- [ ] Gjennomføre regresjonstest etter hver endring.

## Arbeidsform

Små steg, én avgrenset endring om gangen. Behold fungerende arkitektur og unngå refaktorering uten konkret gevinst. Gjennomgå diff før publisering. Eksisterende workflow kjører ved push til main og deployer også backend og regler; dokumentasjonsendringer bør ikke utløse unødvendig backend-deployment.

## Funksjonstest

1. Logg inn i kontroll.html og opprett ny sesjon.
2. Åpne display.html og koble til via QR-kode fra mobil.
3. Velg multi, sett spørsmål og start runde.
4. Avgi svar fra flere klienter; kontroller antall og søyler.
5. Test vis/skjul og ny runde uten gamle stemmer.
6. Test vote-lock, reconnect og avslutning av sesjon.
7. Gjenta flere runder. Ved endringer i felleslogikk testes også likert, open og wordcloud.
8. Ved innføring av opprydding: test både aktiv sesjon, utløpte data og forsinkede stemmehendelser.

## Drift og feilsøking

Kontroller først fakturering/Blaze, deretter sesjon og join-kode, votes, agg/live og display. Undersøk Cloud Functions-logger dersom stemmer lagres uten å bli aggregert. Ikke endre fungerende kode før feilen er lokalisert.

## Mål

Et stabilt, enkelt live-verktøy for undervisning. Multi prioriteres. Ingen permanent lagring av deltakerrespons eller historikk er ønsket; teknisk lagring under live-bruk beholdes.
