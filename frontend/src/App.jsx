import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { DriverAuthProvider } from "./auth/DriverAuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import RequireDriver from "./auth/RequireDriver";
import RequireModule, { AdminLanding } from "./components/RequireModule";
import { LanguageProvider } from "./i18n/LanguageContext";
import ForgotPassword from "./pages/driver/ForgotPassword";
import Home from "./pages/driver/Home";
import Login from "./pages/driver/Login";
import ManifestDetail from "./pages/driver/ManifestDetail";
import Profile from "./pages/driver/Profile";
import ResetPassword from "./pages/driver/ResetPassword";
import Signup from "./pages/driver/Signup";

// A driver's tab lives for days. When a deploy replaces the fingerprinted
// chunks, a lazy import for a route they have not opened yet fetches a URL
// that no longer exists -- the promise rejects, React renders nothing, and
// the driver gets a blank page exactly where they tapped. That is what
// happened to the scan button.
//
// One automatic reload fixes it: index.html is no-cache, so a reload picks up
// the new chunk names. The sessionStorage flag makes it once and not a loop,
// and it is cleared as soon as anything imports successfully.
const RELOADED = "njv.chunk.reloaded";

function lazyRoute(factory) {
  return lazy(() =>
    factory()
      .then((mod) => {
        sessionStorage.removeItem(RELOADED);
        return mod;
      })
      .catch((err) => {
        if (!sessionStorage.getItem(RELOADED)) {
          sessionStorage.setItem(RELOADED, "1");
          window.location.reload();
          return new Promise(() => {}); // the reload takes over
        }
        throw err;
      }),
  );
}

// Admin subtree is lazy-loaded so the field-facing driver bundle stays small. The
// scan pages pull in the (~450KB) barcode-scanning library, so they're lazy too --
// no reason to make every driver download that just to sign in or check history.
const AdminGate = lazyRoute(() => import("./pages/admin/Gate"));
const AdminDashboard = lazyRoute(() => import("./pages/admin/Dashboard"));
const AdminJobs = lazyRoute(() => import("./pages/admin/Jobs"));
const AdminEvidence = lazyRoute(() => import("./pages/admin/Evidence"));
const AdminDriverPerformance = lazyRoute(() => import("./pages/admin/DriverPerformance"));
const AdminDiagnostics = lazyRoute(() => import("./pages/admin/Diagnostics"));
const AdminAccessControl = lazyRoute(() => import("./pages/admin/AccessControl"));
const ConfigLayout = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ConfigurationLayout }))
);
const ConfigIndex = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ConfigIndex }))
);
const ConfigOutlets = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.OutletsConfig }))
);
const ConfigSample = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.SampleData }))
);
const ConfigActivity = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ActivityLog }))
);
const ConfigWindows = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.TripWindows }))
);
const ConfigDrivers = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.DriversConfig }))
);
const ConfigReasons = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ReasonCodes }))
);
const ConfigTargets = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.Targets }))
);
const ConfigDriverApp = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.DriverApp }))
);
const AdminJobDetail = lazyRoute(() => import("./pages/admin/JobDetail"));
const ScanRegister = lazyRoute(() => import("./pages/driver/ScanRegister"));
const ScanComplete = lazyRoute(() => import("./pages/driver/ScanComplete"));

const Guard = RequireModule;

export default function App() {
  return (
    <ErrorBoundary>
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
            <Route index element={<AdminLanding />} />
            <Route path="dashboard" element={<Guard module="dashboard"><AdminDashboard /></Guard>} />
            <Route path="evidence" element={<Guard module="evidence"><AdminEvidence /></Guard>} />
            <Route path="performance" element={<Guard module="driver_performance"><AdminDriverPerformance /></Guard>} />
            <Route path="diagnostics" element={<Guard module="diagnostics" fieldset={false}><AdminDiagnostics /></Guard>} />
            <Route path="jobs" element={<Guard module="orders"><AdminJobs /></Guard>} />
            <Route path="jobs/:jobId" element={<Guard module="orders"><AdminJobDetail /></Guard>} />

            {/* Setup, grouped under one menu rather than sitting in the work row.
                Each page carries the module that opens it; the tab strip and the
                menu draw only the ones a role holds. */}
            <Route path="config" element={<ConfigLayout />}>
              <Route index element={<ConfigIndex />} />
              <Route
                path="drivers"
                element={
                  <Guard module="drivers" fieldset={false}
                         also={{ module: "driver_passwords", text: "setting a driver's password" }}>
                    <ConfigDrivers />
                  </Guard>
                }
              />
              <Route path="access" element={<Guard module="access"><AdminAccessControl /></Guard>} />
              <Route path="outlets" element={<Guard module="outlets"><ConfigOutlets /></Guard>} />
              <Route path="windows" element={<Guard module="windows"><ConfigWindows /></Guard>} />
              <Route path="reasons" element={<Guard module="reasons"><ConfigReasons /></Guard>} />
              <Route path="targets" element={<Guard module="targets"><ConfigTargets /></Guard>} />
              <Route path="driver-app" element={<Guard module="driver_app"><ConfigDriverApp /></Guard>} />
              <Route path="activity" element={<Guard module="activity"><ConfigActivity /></Guard>} />
              <Route path="sample" element={<Guard module="sample"><ConfigSample /></Guard>} />
            </Route>

            {/* Old paths kept working -- an admin with a bookmark should not hit a blank page. */}
            <Route path="drivers" element={<Navigate to="/admin/config/drivers" replace />} />
            <Route path="admins" element={<Navigate to="/admin/config/access" replace />} />
            <Route path="config/admins" element={<Navigate to="/admin/config/access" replace />} />
            <Route path="warehouses" element={<Navigate to="/admin/config/outlets" replace />} />
          </Route>
        </Routes>
      </DriverAuthProvider>
      </LanguageProvider>
    </Router>
    </ErrorBoundary>
  );
}
