import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { DriverAuthProvider } from "./auth/DriverAuthContext";
import RequireDriver from "./auth/RequireDriver";
import { LanguageProvider } from "./i18n/LanguageContext";
import ForgotPassword from "./pages/driver/ForgotPassword";
import Home from "./pages/driver/Home";
import Login from "./pages/driver/Login";
import ManifestDetail from "./pages/driver/ManifestDetail";
import Profile from "./pages/driver/Profile";
import ResetPassword from "./pages/driver/ResetPassword";
import Signup from "./pages/driver/Signup";

// Admin subtree is lazy-loaded so the field-facing driver bundle stays small. The
// scan pages pull in the (~450KB) barcode-scanning library, so they're lazy too --
// no reason to make every driver download that just to sign in or check history.
const AdminGate = lazy(() => import("./pages/admin/Gate"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminWarehouses = lazy(() => import("./pages/admin/Warehouses"));
const AdminJobs = lazy(() => import("./pages/admin/Jobs"));
const AdminEvidence = lazy(() => import("./pages/admin/Evidence"));
const ConfigLayout = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ConfigurationLayout }))
);
const ConfigActivity = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ActivityLog }))
);
const ConfigWindows = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.TripWindows }))
);
const ConfigDrivers = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.DriversConfig }))
);
const ConfigAdmins = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.AdminsConfig }))
);
const ConfigReasons = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ReasonCodes }))
);
const ConfigTargets = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.Targets }))
);
const ConfigRoster = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.Roster }))
);
const ConfigDriverApp = lazy(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.DriverApp }))
);
const AdminJobDetail = lazy(() => import("./pages/admin/JobDetail"));
const ScanRegister = lazy(() => import("./pages/driver/ScanRegister"));
const ScanComplete = lazy(() => import("./pages/driver/ScanComplete"));

export default function App() {
  return (
    <Router>
      <LanguageProvider>
      <DriverAuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/driver" replace />} />

          <Route path="/driver/login" element={<Login />} />
          <Route path="/driver/signup" element={<Signup />} />
          <Route path="/driver/forgot-password" element={<ForgotPassword />} />
          <Route path="/driver/reset-password" element={<ResetPassword />} />
          <Route
            path="/driver"
            element={
              <RequireDriver>
                <Home />
              </RequireDriver>
            }
          />
          <Route
            path="/driver/manifests/:manifestId/register"
            element={
              <RequireDriver>
                <Suspense fallback={null}>
                  <ScanRegister />
                </Suspense>
              </RequireDriver>
            }
          />
          <Route
            path="/driver/scans/complete"
            element={
              <RequireDriver>
                <Suspense fallback={null}>
                  <ScanComplete />
                </Suspense>
              </RequireDriver>
            }
          />
          <Route
            path="/driver/manifests/:manifestId"
            element={
              <RequireDriver>
                <ManifestDetail />
              </RequireDriver>
            }
          />
          <Route
            path="/driver/profile"
            element={
              <RequireDriver>
                <Profile />
              </RequireDriver>
            }
          />

          <Route
            path="/admin"
            element={
              <Suspense fallback={null}>
                <AdminGate />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="evidence" element={<AdminEvidence />} />
            <Route path="jobs" element={<AdminJobs />} />
            <Route path="jobs/:jobId" element={<AdminJobDetail />} />

            {/* Setup, grouped under one menu rather than sitting in the work row. */}
            <Route path="config" element={<ConfigLayout />}>
              <Route index element={<Navigate to="/admin/config/drivers" replace />} />
              <Route path="drivers" element={<ConfigDrivers />} />
              <Route path="admins" element={<ConfigAdmins />} />
              <Route path="outlets" element={<AdminWarehouses />} />
              <Route path="windows" element={<ConfigWindows />} />
              <Route path="reasons" element={<ConfigReasons />} />
              <Route path="targets" element={<ConfigTargets />} />
              <Route path="roster" element={<ConfigRoster />} />
              <Route path="driver-app" element={<ConfigDriverApp />} />
              <Route path="activity" element={<ConfigActivity />} />
            </Route>

            {/* Old paths kept working -- an admin with a bookmark should not hit a blank page. */}
            <Route path="drivers" element={<Navigate to="/admin/config/drivers" replace />} />
            <Route path="admins" element={<Navigate to="/admin/config/admins" replace />} />
            <Route path="warehouses" element={<Navigate to="/admin/config/outlets" replace />} />
          </Route>
        </Routes>
      </DriverAuthProvider>
      </LanguageProvider>
    </Router>
  );
}
