import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./contexts/AuthContext";
import { ManagerApp } from "./apps/ManagerApp";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ManagerApp />
    </AuthProvider>
  </React.StrictMode>,
);
