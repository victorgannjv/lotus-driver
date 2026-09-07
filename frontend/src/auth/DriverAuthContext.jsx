import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "../api";

const DriverAuthContext = createContext(null);

export function DriverAuthProvider({ children }) {
  const [driver, setDriver] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("lotus_driver_user");
    if (getToken() && stored) setDriver(JSON.parse(stored));
    setReady(true);
  }, []);

  function persist(token, user) {
    setToken(token);
    localStorage.setItem("lotus_driver_user", JSON.stringify(user));
    setDriver(user);
  }

  async function login(email, password) {
    const { token, user } = await api.post("/auth/login", { email, password });
    persist(token, user);
  }

  async function signup(email, password, name, phone, warehouseId) {
    const { token, user } = await api.post("/auth/signup", {
      email,
      password,
      name,
      phone,
      warehouse_id: warehouseId,
    });
    persist(token, user);
  }

  async function forgotPassword(email) {
    await api.post("/auth/forgot-password", { email });
  }

  async function resetPassword(resetToken, newPassword) {
    const { token, user } = await api.post("/auth/reset-password", { token: resetToken, new_password: newPassword });
    persist(token, user);
  }

  async function updateWarehouse(warehouseId) {
    const { user } = await api.put("/driver/warehouse", { warehouse_id: warehouseId });
    localStorage.setItem("lotus_driver_user", JSON.stringify(user));
    setDriver(user);
  }

  function logout() {
    setToken(null);
    localStorage.removeItem("lotus_driver_user");
    setDriver(null);
  }

  return (
    <DriverAuthContext.Provider
      value={{ driver, ready, login, signup, forgotPassword, resetPassword, updateWarehouse, logout }}
    >
      {children}
    </DriverAuthContext.Provider>
  );
}

export function useDriverAuth() {
  return useContext(DriverAuthContext);
}
