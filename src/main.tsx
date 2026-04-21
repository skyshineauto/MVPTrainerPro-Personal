// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";

// ✅ MUST load both
import "./index.css";
import "./App.css";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);