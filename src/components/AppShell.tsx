import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

type AppShellProps = {
  product: string;
  navigation: ReactNode;
  navigationLabel?: string;
  footer?: ReactNode;
  userEmail?: string | null;
  onSignOut?: () => void | Promise<void>;
  children: ReactNode;
};

export function AppShell({
  product,
  navigation,
  navigationLabel = "Menu principal",
  footer,
  userEmail,
  onSignOut,
  children,
}: AppShellProps) {
  const { signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (!drawerOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  async function handleSignOut() {
    setSignOutError("");
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        await signOut();
      }
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : "Não foi possível sair.",
      );
    }
  }

  const brand = (
    <>
      <img className="app-shell-logo" src="/icon-porttag-192.png" alt="" />
      <span className="app-shell-brand-copy">
        <strong>PortTag</strong>
        <span>{product}</span>
      </span>
    </>
  );

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`app-shell-scrim${drawerOpen ? " is-open" : ""}`}
        aria-label="Fechar menu"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => setDrawerOpen(false)}
      />

      <aside
        className={`app-shell-sidebar${drawerOpen ? " is-open" : ""}`}
        aria-label="Menu lateral"
      >
        <div className="app-shell-brand">
          {brand}
          <button
            type="button"
            className="app-shell-close"
            aria-label="Fechar menu"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav
          className="app-shell-nav"
          aria-label={navigationLabel}
          onClick={() => setDrawerOpen(false)}
        >
          {navigation}
        </nav>

        <div className="app-shell-footer">
          {footer ? (
            <div
              className="app-shell-external"
              onClick={() => setDrawerOpen(false)}
            >
              {footer}
            </div>
          ) : null}

          {userEmail ? (
            <div className="app-shell-user" title={userEmail}>
              <span className="app-shell-avatar" aria-hidden="true">
                {userEmail.charAt(0).toUpperCase()}
              </span>
              <span className="app-shell-user-email">{userEmail}</span>
            </div>
          ) : null}

          <button
            type="button"
            className="app-shell-signout"
            onClick={() => void handleSignOut()}
          >
            <LogOut size={16} /> Sair
          </button>

          {signOutError ? (
            <p className="app-shell-error" role="alert">
              {signOutError}
            </p>
          ) : null}
        </div>
      </aside>

      <div className="app-shell-body">
        <header className="app-shell-topbar">
          <button
            type="button"
            className="app-shell-menu-button"
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="app-shell-topbar-brand">{brand}</div>
          {userEmail ? (
            <span className="app-shell-topbar-user">{userEmail}</span>
          ) : null}
        </header>

        <div className="app-shell-content">{children}</div>
      </div>
    </div>
  );
}
