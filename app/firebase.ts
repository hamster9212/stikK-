import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB2eA_Wq2BKMUI0Hv2e2he79zt6NKd7lhg",
  authDomain: "stikk-referee.firebaseapp.com",
  projectId: "stikk-referee",
  storageBucket: "stikk-referee.firebasestorage.app",
  messagingSenderId: "101362558299",
  appId: "1:101362558299:web:e91e80654d621bf0cce67e",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
