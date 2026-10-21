import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createApi, type Api } from "./api";
import { KEYS, load, save } from "./storage";
import type { AuthResponse, Role } from "./types";

// ---- Customer session (demo only: there is no real authentication) ----

interface SessionValue {
  session: AuthResponse | null;
  setSession: (session: AuthResponse | null) => void;
}

const SessionContext = createContext<SessionValue>({ session: null, setSession: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<AuthResponse | null>(() => load(KEYS.session, null));
  const value = useMemo(
    () => ({
      session,
      setSession: (s: AuthResponse | null) => {
        save(KEYS.session, s);
        setState(s);
      },
    }),
    [session],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

// ---- Technical details: endpoints, traces and IDs stay hidden unless switched on ----

const TechnicalContext = createContext<{ technical: boolean; setTechnical: (v: boolean) => void }>({
  technical: false,
  setTechnical: () => {},
});

export function TechnicalProvider({ children }: { children: ReactNode }) {
  const [technical, setState] = useState<boolean>(() => load(KEYS.technical, false));
  const value = useMemo(
    () => ({
      technical,
      setTechnical: (v: boolean) => {
        save(KEYS.technical, v || null);
        setState(v);
      },
    }),
    [technical],
  );
  return <TechnicalContext.Provider value={value}>{children}</TechnicalContext.Provider>;
}

export const useTechnical = () => useContext(TechnicalContext);

// ---- API bound to the current role (sent as X-Role) ----

const ApiContext = createContext<{ api: Api; role: Role }>({ api: createApi("customer"), role: "customer" });

export function ApiProvider({ role, children }: { role: Role; children: ReactNode }) {
  const value = useMemo(() => ({ api: createApi(role), role }), [role]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export const useApi = () => useContext(ApiContext).api;
export const useRole = () => useContext(ApiContext).role;
