import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * O Supabase renova o token e emite TOKEN_REFRESHED com um objeto de usuário
 * novo, mas com o mesmo id. Sem estabilizar a identidade, todo refresh (~1x/hora
 * e ao voltar do background) recarrega a tela do porteiro sem ele pedir.
 */
function stabilizeUser(current: User | null, next: User | null): User | null {
  if (
    current?.id === next?.id &&
    current?.updated_at === next?.updated_at
  ) {
    return current;
  }
  return next;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        console.error("Erro ao recuperar sessão:", error);
      }

      setSession(data.session);
      setUser((current) => stabilizeUser(current, data.session?.user ?? null));
      setLoading(false);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;

      setSession(currentSession);
      setUser((current) => stabilizeUser(current, currentSession?.user ?? null));
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;
  }

  return (
    <AuthContext.Provider
      value={{ user, session, loading, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }

  return context;
}
