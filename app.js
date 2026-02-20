/* app.js
   Grunnmur v1: init + auth (ingen writes)
*/
(function () {
  "use strict";

  if (!window.firebase) throw new Error("Firebase SDK (compat) er ikke lastet.");
  if (!window.CONFIG || !CONFIG.firebaseConfig) throw new Error("CONFIG.firebaseConfig mangler (config.js).");

  if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebaseConfig);

  const db = firebase.firestore();
  const auth = firebase.auth();

  window.App = {
  db,
  auth,

  ensureSignedInWithGoogle: async function () {
    const user = auth.currentUser;
    if (user) return user;

    const provider = new firebase.auth.GoogleAuthProvider();
    const res = await auth.signInWithPopup(provider);
    return res.user;
  },

  // ---- Session (grunnlov): én aktiv session per ownerId ----
  getSessionRefForOwner: function (ownerId) {
    // 1 session per bruker, stabil path
    return db.collection("sessions").doc(ownerId);
  },

  startOrReplaceSession: async function () {
    const user = auth.currentUser;
    if (!user) throw new Error("Ikke innlogget.");

    const ownerId = user.uid;
    const sessionRef = this.getSessionRefForOwner(ownerId);

    // Ny sessionId hver gang du starter (men samme doc-path)
    const sessionId = "s_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);

    await sessionRef.set({
      sessionId,
      ownerId,
      status: "active",          // active | ended
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),

      // routing
      activeQuestionId: null,
      roundId: null,             // settes når et spørsmål aktiveres / nullstilles
      mode: null,                // multi | likert | open | wordcloud

      // join
      joinCode: sessionId.slice(-6).toUpperCase(), // enkel kode (ikke sikkerhet)
    }, { merge: true });

    return { sessionRef, ownerId, sessionId };
  }
};


  auth.onAuthStateChanged(() => {});
})();
