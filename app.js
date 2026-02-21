/* app.js
   Undervisningssystem v2 – Steg 0 (reparasjon etter ARCHITECTURE.md)

   Kontrakt:
   - sessionId ≠ ownerId
   - sessions/{sessionId} (aldri sessions/{ownerId})
   - owners/{ownerId} peker på aktiv session
   - joinCodes/{joinCode} router til sessionId
   - state kun under sessions/{sessionId}/state/live
   - controllerId = clientId (localStorage), ikke user.uid
   - Ingen auto-writes ved refresh (kun ved knappetrykk)
*/

(function () {
  "use strict";

  if (!window.firebase) throw new Error("Firebase SDK (compat) er ikke lastet.");
  if (!window.CONFIG || !CONFIG.firebaseConfig) throw new Error("CONFIG.firebaseConfig mangler (config.js).");

  if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebaseConfig);

  const db = firebase.firestore();
  const auth = firebase.auth();

  const CLIENT_ID_KEY = "uv2_clientId";
  const JOINCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  function getOrCreateClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (id && typeof id === "string" && id.length >= 8) return id;

    // Enkel, stabil per browser-instans (ikke sikkerhet, kun identifikator)
    id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function randomJoinCode6() {
    let out = "";
    for (let i = 0; i < 6; i++) {
      out += JOINCODE_ALPHABET[Math.floor(Math.random() * JOINCODE_ALPHABET.length)];
    }
    return out;
  }

  async function generateUniqueJoinCode(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const code = randomJoinCode6();
      const ref = db.collection("joinCodes").doc(code);
      const snap = await ref.get();
      if (!snap.exists) return code;

      // Hvis finnes men er inaktiv, kan vi gjenbruke? Kontrakt sier kollisjonssjekk.
      // For å være konservativ: vi anser "eksisterer" som kollisjon og prøver ny.
    }
    throw new Error("Kunne ikke generere unik joinCode (for mange kollisjoner).");
  }

  window.App = {
    db,
    auth,

    getClientId: function () {
      return getOrCreateClientId();
    },

    ensureSignedInWithGoogle: async function () {
      const user = auth.currentUser;
      if (user) return user;

      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await auth.signInWithPopup(provider);
      return res.user;
    },

    // Refs (kontrakt)
    ownerRef: function (ownerId) {
      return db.collection("owners").doc(ownerId);
    },

    sessionRef: function (sessionId) {
      return db.collection("sessions").doc(sessionId);
    },

    joinCodeRef: function (joinCode) {
      return db.collection("joinCodes").doc(joinCode);
    },

    liveStateRef: function (sessionId) {
      return db.collection("sessions").doc(sessionId).collection("state").doc("live");
    },

    // Les aktiv session (ingen writes)
    getActiveSessionInfo: async function (ownerId) {
      const oRef = this.ownerRef(ownerId);
      const oSnap = await oRef.get();
      if (!oSnap.exists) return null;

      const o = oSnap.data() || {};
      if (!o.activeSessionId || !o.activeJoinCode) return null;

      return {
        ownerId,
        activeSessionId: o.activeSessionId,
        activeJoinCode: o.activeJoinCode
      };
    },

    // Steg 0: Start/replace session (eksplisitt brukerhandling)
    startOrReplaceSession: async function (opts) {
      const user = auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const ownerId = user.uid;
      const clientId = getOrCreateClientId();

      const saveResults = (opts && typeof opts.saveResults === "boolean") ? opts.saveResults : true;
      const programId = (opts && Object.prototype.hasOwnProperty.call(opts, "programId")) ? opts.programId : null;

      // Finn eksisterende aktiv session via owner-peker (les)
      const ownerDocRef = this.ownerRef(ownerId);
      const ownerSnap = await ownerDocRef.get();
      const ownerData = ownerSnap.exists ? (ownerSnap.data() || {}) : {};

      const oldSessionId = ownerData.activeSessionId || null;
      const oldJoinCode = ownerData.activeJoinCode || null;

      // Generer ny sessionId (Firestore doc-id) slik at sessionId != ownerId
      const newSessionDocRef = db.collection("sessions").doc(); // auto-id
      const sessionId = newSessionDocRef.id;

      if (sessionId === ownerId) {
        // Ekstremt usannsynlig, men vi respekterer kontrakten.
        throw new Error("Generert sessionId var lik ownerId (ikke tillatt). Prøv igjen.");
      }

      const joinCode = await generateUniqueJoinCode();

      const batch = db.batch();

      // 1) Avslutt forrige session og deaktiver gammel joinCode (replace-semantikk)
      if (oldSessionId) {
        const oldSessionRef = this.sessionRef(oldSessionId);
        batch.set(oldSessionRef, {
          status: "ended",
          endedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      if (oldJoinCode) {
        const oldJoinRef = this.joinCodeRef(oldJoinCode);
        batch.set(oldJoinRef, { active: false }, { merge: true });
      }

      // 2) Opprett ny session metadata
      batch.set(newSessionDocRef, {
        sessionId,
        ownerId,
        status: "active",
        startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        endedAt: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        joinCode,
        saveResults,
        programId
      }, { merge: false });

      // 3) Opprett joinCode routing
      const newJoinRef = this.joinCodeRef(joinCode);
      batch.set(newJoinRef, {
        sessionId,
        ownerId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true
      }, { merge: false });

      // 4) Oppdater owner-peker
      batch.set(ownerDocRef, {
        activeSessionId: sessionId,
        activeJoinCode: joinCode,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 5) Init state/live (ingen svar, kun styring)
      const stateRef = this.liveStateRef(sessionId);
      batch.set(stateRef, {
        sessionId,
        status: "idle",
        mode: null,
        roundId: null,
        question: null,
        controllerId: clientId
      }, { merge: false });

      await batch.commit();

      return { ownerId, sessionId, joinCode };
    }
  };

  // Viktig: ingen auto-writes her.
  auth.onAuthStateChanged(() => {});
})();