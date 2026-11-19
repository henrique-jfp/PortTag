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
