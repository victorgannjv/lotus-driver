import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { DriverAuthProvider } from "./auth/DriverAuthContext";
import RequireDriver from "./auth/RequireDriver";
import ForgotPassword from "./pages/driver/ForgotPassword";
import Home from "./pages/driver/Home";
import Login from "./pages/driver/Login";
import ManifestDetail from "./pages/driver/ManifestDetail";
import ResetPassword from "./pages/driver/ResetPassword";
import Signup from "./pages/driver/Signup";

// Admin subtree is lazy-loaded so the field-facing driver bundle stays small. The
// scan pages pull in the (~450KB) barcode-scanning library, so they're lazy too --
// no reason to make every driver download that just to sign in or check history.
const AdminGate = lazy(() => import("./pages/admin/Gate"));
const AdminDrivers = lazy(() => import("./pages/admin/Drivers"));
const AdminJobs = lazy(() => import("./pages/admin/Jobs"));
const AdminJobDetail = lazy(() => import("./pages/admin/JobDetail"));
const ScanRegister = lazy(() => import("./pages/driver/ScanRegister"));
const ScanComplete = lazy(() => import("./pages/driver/ScanComplete"));

export default function App() {
  return (
    <Router>
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
            path="/driver/scans/register"
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
            path="/admin"
            element={
              <Suspense fallback={null}>
                <AdminGate />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="/admin/jobs" replace />} />
            <Route path="jobs" element={<AdminJobs />} />
            <Route path="jobs/:jobId" element={<AdminJobDetail />} />
            <Route path="drivers" element={<AdminDrivers />} />
          </Route>
        </Routes>
      </DriverAuthProvider>
    </Router>
  );
}
