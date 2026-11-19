import { useState, type FormEvent } from "react";
import { LockKeyhole, Mail, Package } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { ManagerLedger } from "../pages/ManagerLedger";

function ManagerLogin() {
  const { signIn } = useAuth();
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
    } catch {
      setError("E-mail ou senha incorretos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="manager-login">
      <section className="manager-login-card">
        <div className="brand-icon">
          <Package size={30} />
        </div>
        <p className="eyebrow">PortTag · Síndico</p>
        <h1>Área do Síndico</h1>
        <p className="subtitle">
          Acesse o caderno de registros do seu condomínio.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="manager-email">E-mail</label>
          <div className="input-wrapper">
            <Mail size={18} />
            <input
              id="manager-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <label htmlFor="manager-password">Senha</label>
          <div className="input-wrapper">
            <LockKeyhole size={18} />
            <input
              id="manager-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function ManagerApp() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="loading-screen">Carregando...</div>;
  }
  return user ? <ManagerLedger key={user.id} /> : <ManagerLogin />;
}
