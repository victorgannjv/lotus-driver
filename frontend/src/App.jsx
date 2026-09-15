import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { DriverAuthProvider } from "./auth/DriverAuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import RequireDriver from "./auth/RequireDriver";
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
const ConfigLayout = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.ConfigurationLayout }))
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
const ConfigAdmins = lazyRoute(() =>
  import("./pages/admin/Configuration").then((m) => ({ default: m.AdminsConfig }))
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
              <Route path="outlets" element={<ConfigOutlets />} />
              <Route path="windows" element={<ConfigWindows />} />
              <Route path="reasons" element={<ConfigReasons />} />
              <Route path="targets" element={<ConfigTargets />} />
              <Route path="driver-app" element={<ConfigDriverApp />} />
              <Route path="activity" element={<ConfigActivity />} />
              <Route path="sample" element={<ConfigSample />} />
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
    </ErrorBoundary>
  );
}
