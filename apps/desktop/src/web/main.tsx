import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Oh My Bug ?! root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
