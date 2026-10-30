import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./Auth";
import "./theme.css";

const queryClient = new QueryClient({
  // getState is the one heavy query: a longer staleTime stops iPad focus
  // changes from refiring it, and mutations refresh it explicitly anyway.
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: true, retry: 1 } },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <App />
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
