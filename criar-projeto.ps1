
$ErrorActionPreference = "Stop"

Write-Host "Criando estrutura do projeto..." -ForegroundColor Cyan

$directories = @(
    "src/lib",
    "src/contexts",
    "src/pages"
)

foreach ($directory in $directories) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

function Write-ProjectFile {
    param(
        [string]$Path,
        [string]$Content
    )

    Set-Content -Path $Path -Value $Content -Encoding utf8
    Write-Host "Criado: $Path" -ForegroundColor Green
}

Write-ProjectFile "src/lib/supabase.ts" @'
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
'@

Write-ProjectFile "src/contexts/AuthContext.tsx" @'
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
      setUser(data.session?.user ?? null);
      setLoading(false);
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!mounted) return;

      setSession(currentSession);
      setUser(currentSession?.user ?? null);
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
'@

Write-ProjectFile "src/pages/Login.tsx" @'
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Package, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn(email.trim(), password);
      navigate("/", { replace: true });
    } catch {
      setError("E-mail ou senha inválidos. Confira seus dados.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-icon">
          <Package size={30} />
        </div>

        <h1>Controle de Encomendas</h1>
        <p className="subtitle">
          Acesse o painel de gerenciamento do condomínio.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">E-mail</label>
          <div className="input-wrapper">
            <Mail size={18} />
            <input
              id="email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <label htmlFor="password">Senha</label>
          <div className="input-wrapper">
            <LockKeyhole size={18} />
            <input
              id="password"
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p className="error-message">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="footer-note">
          Sistema de gestão de encomendas para condomínios
        </p>
      </section>
    </main>
  );
}
'@

Write-ProjectFile "src/App.tsx" @'
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./pages/Login";

function Dashboard() {
  const { user, signOut } = useAuth();

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      console.error("Erro ao sair:", error);
    }
  }

  return (
    <main className="dashboard">
      <header>
        <div>
          <h1>Painel de controle</h1>
          <p>Bem-vindo ao sistema de encomendas.</p>
        </div>

        <button onClick={handleSignOut}>Sair</button>
      </header>

      <section className="welcome-card">
        <h2>Autenticação funcionando!</h2>
        <p>Usuário conectado: {user?.email}</p>
        <p>
          Na próxima etapa, vamos conectar este painel ao cadastro
          de condomínios.
        </p>
      </section>
    </main>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Carregando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Carregando...</div>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
'@

Write-ProjectFile "src/main.tsx" @'
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
'@

Write-ProjectFile "src/index.css" @'
@import "tailwindcss";

:root {
  font-family: Inter, system-ui, sans-serif;
  color: #172033;
  background: #f3f5f9;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input {
  font: inherit;
}

.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 36px;
  background: white;
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(20, 35, 65, 0.08);
}

.brand-icon {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: #e8efff;
  color: #2859c5;
  margin-bottom: 24px;
}

.login-card h1 {
  font-size: 25px;
  margin: 0 0 8px;
}

.subtitle {
  color: #697386;
  line-height: 1.5;
  margin-bottom: 28px;
}

.login-card form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-card label {
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
}

.input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 48px;
  border: 1px solid #dce1eb;
  border-radius: 9px;
  color: #7b8495;
}

.input-wrapper:focus-within {
  border-color: #3568d4;
}

.input-wrapper input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: #172033;
}

.login-card button,
.dashboard header button {
  height: 48px;
  border: none;
  border-radius: 9px;
  background: #2859c5;
  color: white;
  font-weight: 600;
  cursor: pointer;
  margin-top: 12px;
}

.login-card button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.error-message {
  color: #bd3030;
  font-size: 13px;
}

.footer-note {
  margin: 24px 0 0;
  color: #8992a2;
  text-align: center;
  font-size: 12px;
}

.loading-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #697386;
}

.dashboard {
  max-width: 1100px;
  margin: 0 auto;
  padding: 36px 24px;
}

.dashboard header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.dashboard header h1 {
  margin-bottom: 6px;
}

.dashboard header p {
  color: #697386;
}

.dashboard header button {
  padding: 0 24px;
}

.welcome-card {
  margin-top: 30px;
  padding: 28px;
  border-radius: 16px;
  background: white;
  box-shadow: 0 8px 28px rgba(20, 35, 65, 0.05);
}

.welcome-card p {
  color: #697386;
  line-height: 1.6;
}

@media (max-width: 520px) {
  .login-card {
    padding: 26px;
  }

  .dashboard header {
    align-items: flex-start;
    flex-direction: column;
  }
}
'@

Write-ProjectFile "vite.config.ts" @'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
'@

Write-ProjectFile ".env.example" @'
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
'@

Write-ProjectFile ".gitignore" @'
node_modules
dist
.env
.env.local
.env.*.local
'@

Write-ProjectFile "README.md" @'
# Controle de Encomendas

Aplicação web para gestão de encomendas em condomínios.

## Requisitos

- Node.js
- npm
- Projeto Supabase

## Instalação

1. Instale as dependências:

   npm install

2. Copie `.env.example` para `.env.local`.

3. Preencha as variáveis com a URL do projeto Supabase
   e a chave pública (publishable ou anon).

4. Execute:

   npm run dev

5. Abra o endereço exibido no terminal.

## Observação

Nunca coloque a chave service_role no frontend.
As permissões dos dados devem ser protegidas pelo RLS
do Supabase.
'@

Write-Host "Instalando dependências..." -ForegroundColor Cyan

npm install
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar as dependências."
}

npm install @supabase/supabase-js react-router-dom lucide-react
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar as dependências da aplicação."
}

npm install tailwindcss @tailwindcss/vite
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar Tailwind."
}

Write-Host ""
Write-Host "Arquivos criados com sucesso!" -ForegroundColor Green
Write-Host "Agora crie seu .env.local com as credenciais públicas do Supabase."
Write-Host "Depois execute: npm run dev"
