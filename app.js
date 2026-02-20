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
    }
  };

  auth.onAuthStateChanged(() => {});
})();
