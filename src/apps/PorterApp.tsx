import { useState, type FormEvent } from "react";
import { Camera, LockKeyhole, UserRound } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { normalizePorterUsername, porterLoginEmail } from "../lib/porterAccounts";
import { PorterReception } from "../pages/PorterReception";

function PorterLogin() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(porterLoginEmail(username), password);
    } catch {
      setError("Usuário ou senha incorretos. Confira os dados com o responsável.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="porter-login">
      <section className="porter-login-card">
        <div className="porter-brand-mark">
          <Camera size={30} aria-hidden="true" />
        </div>
        <p className="porter-login-eyebrow">PortTag · Portaria</p>
        <h1>Receber encomenda</h1>
        <p>
          Acesso da portaria: entre com o usuário e a senha entregues pelo
          responsável.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="porter-username">Usuário</label>
          <div className="porter-login-input">
            <UserRound size={20} aria-hidden="true" />
            <input
              id="porter-username"
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) =>
                setUsername(normalizePorterUsername(event.target.value))
              }
            />
          </div>
          <label htmlFor="porter-password">Senha</label>
          <div className="porter-login-input">
            <LockKeyhole size={20} aria-hidden="true" />
            <input
              id="porter-password"
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && <p className="porter-error" role="alert">{error}</p>}
          <button className="porter-primary-button" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function PorterApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Carregando...</div>;
  }

  return user ? <PorterReception key={user.id} /> : <PorterLogin />;
}
