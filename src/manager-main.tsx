import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./contexts/AuthContext";
import { ManagerApp } from "./apps/ManagerApp";
import "./index.css";
import "./admin.css";
import "./notebook.css";
import "./manager.css";
import "./shell.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sem service worker o app continua funcionando online.
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ManagerApp />
    </AuthProvider>
  </React.StrictMode>,
);
