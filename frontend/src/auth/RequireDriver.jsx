import { Navigate } from "react-router-dom";
import { useDriverAuth } from "./DriverAuthContext";

export default function RequireDriver({ children }) {
  const { driver, ready } = useDriverAuth();
  if (!ready) return null;
  if (!driver) return <Navigate to="/driver/login" replace />;
  return children;
}
