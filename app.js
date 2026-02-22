(function () {
  "use strict";

  if (!window.firebase) throw new Error("Firebase SDK (compat) er ikke lastet.");
  if (!window.CONFIG || !CONFIG.firebaseConfig) throw new Error("CONFIG.firebaseConfig mangler (config.js).");

  if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebaseConfig);

  const db = firebase.firestore();
  const auth = firebase.auth ? firebase.auth() : null;

  const CLIENT_ID_KEY = "uv2_clientId";
  const PARTICIPANT_SESSION_KEY = "uv2_participant_session";
  const JOINCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const LEASE_TTL_MS = 60 * 1000;

  function getOrCreateClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (id && typeof id === "string" && id.length >= 8) return id;
    id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function leaseUntilTimestampFromNow() {
    return firebase.firestore.Timestamp.fromMillis(Date.now() + LEASE_TTL_MS);
  }

  function randomJoinCode6() {
    let out = "";
    for (let i = 0; i < 6; i++) out += JOINCODE_ALPHABET[Math.floor(Math.random() * JOINCODE_ALPHABET.length)];
    return out;
  }

  async function generateUniqueJoinCode(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const code = randomJoinCode6();
      const snap = await db.collection("joinCodes").doc(code).get();
      if (!snap.exists) return code;
    }
    throw new Error("Kunne ikke generere unik joinCode (for mange kollisjoner).");
  }

  window.App = {
    db,
    auth,

    // ---- Shared identity ----
    getClientId: function () {
      return getOrCreateClientId();
    },

    // ---- Refs (kontrakt) ----
    ownerRef: (ownerId) => db.collection("owners").doc(ownerId),
    sessionRef: (sessionId) => db.collection("sessions").doc(sessionId),
    joinCodeRef: (joinCode) => db.collection("joinCodes").doc(joinCode),
    liveStateRef: (sessionId) => db.collection("sessions").doc(sessionId).collection("state").doc("live"),

    // ---- Steg 2: Join routing (READ ONLY) ----
    resolveJoinCode: async function (joinCode) {
      const code = (joinCode || "").toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("JoinCode må være 6 tegn (A–Z/0–9).");

      const ref = this.joinCodeRef(code);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Ukjent joinCode.");

      const data = snap.data() || {};
      if (data.active !== true) throw new Error("JoinCode er ikke aktiv (utløpt/erstattet).");
      if (!data.sessionId) throw new Error("JoinCode mangler sessionId.");

      return { joinCode: code, sessionId: data.sessionId, ownerId: data.ownerId || null };
    },

    setParticipantSession: function (sessionId, joinCode) {
      const payload = {
        sessionId: sessionId || null,
        joinCode: (joinCode || "").toUpperCase(),
        clientId: getOrCreateClientId(),
        savedAtMs: Date.now()
      };
      localStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify(payload));
    },

    getParticipantSession: function () {
      const raw = localStorage.getItem(PARTICIPANT_SESSION_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },

    // ---- Listen (read) ----
    listenLiveState: function (sessionId, onData, onError) {
      const ref = this.liveStateRef(sessionId);
      return ref.onSnapshot(
        (snap) => onData(snap.exists ? (snap.data() || {}) : null),
        (err) => onError && onError(err)
      );
    },

    // ---- Existing (Steg 0/1) controller flow (unchanged semantics) ----
    ensureSignedInWithGoogle: async function () {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (user) return user;

      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await this.auth.signInWithPopup(provider);
      return res.user;
    },

    getActiveSessionInfo: async function (ownerId) {
      const snap = await this.ownerRef(ownerId).get();
      if (!snap.exists) return null;
      const o = snap.data() || {};
      if (!o.activeSessionId || !o.activeJoinCode) return null;
      return { ownerId, activeSessionId: o.activeSessionId, activeJoinCode: o.activeJoinCode };
    },

    startOrReplaceSession: async function (opts) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const ownerId = user.uid;
      const clientId = getOrCreateClientId();

      const saveResults = (opts && typeof opts.saveResults === "boolean") ? opts.saveResults : true;
      const programId = (opts && Object.prototype.hasOwnProperty.call(opts, "programId")) ? opts.programId : null;

      const ownerDocRef = this.ownerRef(ownerId);
      const ownerSnap = await ownerDocRef.get();
      const ownerData = ownerSnap.exists ? (ownerSnap.data() || {}) : {};

      const oldSessionId = ownerData.activeSessionId || null;
      const oldJoinCode = ownerData.activeJoinCode || null;

      const newSessionDocRef = db.collection("sessions").doc();
      const sessionId = newSessionDocRef.id;
      if (sessionId === ownerId) throw new Error("Generert sessionId var lik ownerId (ikke tillatt).");

      const joinCode = await generateUniqueJoinCode();
      const batch = db.batch();

      if (oldSessionId) {
        batch.set(this.sessionRef(oldSessionId), {
          status: "ended",
          endedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      if (oldJoinCode) {
        batch.set(this.joinCodeRef(oldJoinCode), { active: false }, { merge: true });
      }

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

      batch.set(this.joinCodeRef(joinCode), {
        sessionId,
        ownerId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true
      }, { merge: false });

      batch.set(ownerDocRef, {
        activeSessionId: sessionId,
        activeJoinCode: joinCode,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      batch.set(this.liveStateRef(sessionId), {
        sessionId,
        status: "idle",
        mode: null,
        roundId: null,
        question: null,

        // Steg 1 (lease)
        controllerId: clientId,
        controllerTs: firebase.firestore.FieldValue.serverTimestamp(),
        controllerLeaseUntil: leaseUntilTimestampFromNow()
      }, { merge: false });

      await batch.commit();
      return { ownerId, sessionId, joinCode };
    }
  };

  if (auth) auth.onAuthStateChanged(() => {});
})();