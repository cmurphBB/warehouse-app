import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { callAction } from "./api";
import { supabase } from "./supabase";

const NAVY = "#052A78";
const ORANGE = "#FF6700";

export type Me = { name: string; email: string; role: "ADMIN" | "MANAGER" | "WAREHOUSE" | "TECHNICIAN" | "VIEW_ONLY" };
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export const canManage = (me: Me | null) => me?.role === "ADMIN" || me?.role === "MANAGER";

const ROLE_LABEL: Record<Me["role"], string> = { ADMIN: "Admin", MANAGER: "Manager", WAREHOUSE: "Warehouse", TECHNICIAN: "Tech", VIEW_ONLY: "View only" };

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMe(null); setMeError("");
    if (!session) { qc.clear(); return; }
    callAction<Me>("whoAmI", {}).then(setMe).catch((e) => setMeError(e.message));
  }, [session?.user.id]);

  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <Login />;
  if (meError) return <Splash text={meError} action={<button onClick={() => supabase.auth.signOut()} className="mt-4 px-5 py-3 rounded-xl text-white font-bold" style={{ background: NAVY }}>Sign out</button>} />;
  if (!me) return <Splash text="Signing in…" />;

  return (
    <MeContext.Provider value={me}>
      <div className="px-4 py-1.5 text-[12px] font-semibold flex items-center justify-end gap-3" style={{ background: "#031B4E", color: "rgba(255,255,255,.8)" }}>
        <span className="truncate">{me.name} · {ROLE_LABEL[me.role] ?? me.role}</span>
        <button onClick={() => supabase.auth.signOut()} className="underline shrink-0">Sign out</button>
      </div>
      {children}
    </MeContext.Provider>
  );
}

function Splash({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center"><p className="font-display font-bold text-lg" style={{ color: NAVY }}>{text}</p>{action}</div>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
  };
  const sendLink = async () => {
    if (!email.trim()) return setMsg({ ok: false, text: "Enter your email first." });
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin } });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Check your email for a sign-in link." });
  };

  const field = "mt-1 w-full rounded-xl px-4 py-3.5 text-base font-semibold";
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <p className="font-display font-black text-2xl leading-none tracking-tight" style={{ color: NAVY }}>BLUE BEAR <span style={{ color: ORANGE }}>INVENTORY</span></p>
        <p className="text-sm mt-2" style={{ color: "var(--dim)" }}>Sign in with your Blue Bear warehouse login.</p>
        <label className="block mt-5 text-xs font-bold">Email<input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
        <label className="block mt-3 text-xs font-bold">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
        <button type="submit" disabled={busy || !email || !password} className="mt-5 w-full py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: NAVY }}>Sign in</button>
        <button type="button" disabled={busy} onClick={sendLink} className="mt-2 w-full py-3 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Email me a sign-in link</button>
        {msg && <p className="mt-3 text-sm font-semibold" style={{ color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</p>}
      </form>
    </div>
  );
}
