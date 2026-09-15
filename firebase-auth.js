/* Firebase anonymous authentication for the protected Quran ASR endpoint.
 * No personal profile data is requested or stored. The resulting short-lived
 * ID token is sent only to the project's Cloud Run service.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCM6PKyiJ53CSGEDQpLxk4czmV9Vro0_as",
  authDomain: "ihfad-2fecd.firebaseapp.com",
  projectId: "ihfad-2fecd",
  storageBucket: "ihfad-2fecd.firebasestorage.app",
  messagingSenderId: "185800313271",
  appId: "1:185800313271:web:84b269e7e72fdd1ea80032"
};

const auth = getAuth(initializeApp(firebaseConfig));
const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    unsubscribe();
    if (user) return resolve(user);
    try {
      resolve((await signInAnonymously(auth)).user);
    } catch (error) {
      console.warn("[Quran ASR] Anonymous Firebase sign-in is unavailable.", error.code || error.message);
      resolve(null);
    }
  });
});

window.getFirebaseIdToken = async () => {
  const user = await authReady;
  return user ? user.getIdToken() : null;
};
