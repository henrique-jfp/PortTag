import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";

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

      <Route
        path="/condominiums/:condominiumId/units"
        element={
          <ProtectedRoute>
            <Suspense
              fallback={
                <div className="loading-screen">Carregando unidades...</div>
              }
            >
              <CondominiumUnits />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        path="/label-lab"
        element={
          <ProtectedRoute>
            <Suspense
              fallback={
                <div className="loading-screen">Carregando Label Lab...</div>
              }
            >
              <LabelLab />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
