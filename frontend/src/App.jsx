import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { DriverAuthProvider } from "./auth/DriverAuthContext";
import RequireDriver from "./auth/RequireDriver";
import Home from "./pages/driver/Home";
import JobCheckin from "./pages/driver/JobCheckin";
import Login from "./pages/driver/Login";
import ManifestDetail from "./pages/driver/ManifestDetail";
import ManifestUpload from "./pages/driver/ManifestUpload";
import Signup from "./pages/driver/Signup";

// Admin subtree is lazy-loaded so the field-facing driver bundle stays small.
const AdminGate = lazy(() => import("./pages/admin/Gate"));
const AdminDrivers = lazy(() => import("./pages/admin/Drivers"));
const AdminJobs = lazy(() => import("./pages/admin/Jobs"));
const AdminJobDetail = lazy(() => import("./pages/admin/JobDetail"));
const AdminReviewQueue = lazy(() => import("./pages/admin/ReviewQueue"));

export default function App() {
  return (
    <Router>
      <DriverAuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/driver" replace />} />

          <Route path="/driver/login" element={<Login />} />
          <Route path="/driver/signup" element={<Signup />} />
          <Route
            path="/driver"
            element={
              <RequireDriver>
                <Home />
              </RequireDriver>
            }
          />
          <Route
            path="/driver/manifests/new"
            element={
              <RequireDriver>
                <ManifestUpload />
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
            path="/driver/jobs/:jobId/checkin"
            element={
              <RequireDriver>
                <JobCheckin />
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
            <Route path="review" element={<AdminReviewQueue />} />
          </Route>
        </Routes>
      </DriverAuthProvider>
    </Router>
  );
}
