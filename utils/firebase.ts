// utils/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";

function isBrowser() {
  return typeof window !== "undefined";
}

function getFirebaseConfig() {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID!
  };
}

export function getFirebaseApp(): FirebaseApp {
  if (!isBrowser()) {
    // Prevent Firebase from being initialized during server/static rendering
    throw new Error("Firebase app requested on server (window is undefined).");
  }
  return getApps().length ? getApp() : initializeApp(getFirebaseConfig());
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}