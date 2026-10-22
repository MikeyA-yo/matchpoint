import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { SessionProvider, TechnicalProvider } from "./lib/context";
import { dropStaleData } from "./lib/storage";
import "./styles.css";

dropStaleData();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <TechnicalProvider>
          <App />
        </TechnicalProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
