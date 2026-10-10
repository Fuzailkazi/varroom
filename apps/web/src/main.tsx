import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { TooltipProvider } from "./components/ui/tooltip";
import { App } from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find the root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
);
