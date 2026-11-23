import { lazy, Suspense, type ReactNode } from "react";
import {
  Building2,
  ClipboardList,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

const AdminNotebook = lazy(() =>
  import("./pages/AdminNotebook").then((module) => ({
    default: module.AdminNotebook,
  })),
);

const CondominiumUnits = lazy(() =>
  import("./pages/CondominiumUnits").then((module) => ({
    default: module.CondominiumUnits,
  })),
);

const LabelLab = lazy(() =>
  import("./pages/LabelLab").then((module) => ({
    default: module.LabelLab,
  })),
);

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

function AdminLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const painelActive = location.pathname === "/";
  const condominiumsActive = location.pathname.startsWith("/condominiums");
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? "is-active" : undefined;

  const navigation = (
    <>
      <p className="app-shell-nav-label">Navegação</p>
      <NavLink
        to="/"
        className={painelActive ? "is-active" : linkClass({ isActive: false })}
      >
        <LayoutDashboard size={17} /> Painel
      </NavLink>
      <NavLink
        to="/condominiums"
        className={
          condominiumsActive ? "is-active" : linkClass({ isActive: false })
        }
      >
        <Building2 size={17} /> Condomínios
      </NavLink>
      <NavLink to="/notebook" className={linkClass}>
        <ClipboardList size={17} /> Caderno
      </NavLink>
      <NavLink to="/label-lab" className={linkClass}>
        <FlaskConical size={17} /> Label Lab
      </NavLink>
    </>
  );

  const footer = (
    <>
      <a href="/manager.html">
        <Building2 size={16} /> Abrir Síndico
      </a>
      <a href="/porter.html">
        <ExternalLink size={16} /> Abrir Portaria
      </a>
    </>
  );

  return (
    <AppShell
      product="Super Admin"
      navigation={navigation}
      navigationLabel="Menu do Super Admin"
      footer={footer}
      userEmail={user?.email}
    >
      <Outlet />
    </AppShell>
  );
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

      <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route path="/" element={<Dashboard />} />

        <Route path="/condominiums" element={<Dashboard listView />} />

        <Route
          path="/notebook"
          element={
            <Suspense
              fallback={<div className="loading-screen">Carregando caderno...</div>}
            >
              <AdminNotebook />
            </Suspense>
          }
        />

        <Route
          path="/condominiums/:condominiumId/units"
          element={
            <Suspense
              fallback={
                <div className="loading-screen">Carregando unidades...</div>
              }
            >
              <CondominiumUnits />
            </Suspense>
          }
        />

        <Route
          path="/label-lab"
          element={
            <Suspense
              fallback={
                <div className="loading-screen">Carregando Label Lab...</div>
              }
            >
              <LabelLab />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
