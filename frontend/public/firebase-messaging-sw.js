// Background service worker for Firebase Cloud Messaging.
// Service Workers cannot use ES module `import` syntax unless registered with
// `type: "module"`, so this file uses importScripts() with the Firebase compat
// UMD bundles — the standard approach documented by Firebase.
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Firebase config keys are intentionally public (not secrets).
// The SW cannot read import.meta.env, so values are inlined here.
// Keep in sync with frontend/.env.local / hosting env vars.
firebase.initializeApp({
  apiKey: "AIzaSyCxieRXBS4uEYm61u6ZlXhfYVNKq9BUOPE",
  authDomain: "smartalerts-ae4ec.firebaseapp.com",
  projectId: "smartalerts-ae4ec",
  storageBucket: "smartalerts-ae4ec.firebasestorage.app",
  messagingSenderId: "126699127825",
  appId: "1:126699127825:web:23cfd14ecd078d57c69db0",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Smart Alert";
  const options = {
    body: payload.notification?.body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: payload.data,
  };
  self.registration.showNotification(title, options);
});
