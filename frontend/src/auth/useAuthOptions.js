import { useEffect, useState } from "react";
import { api } from "../api";

// Flags the signed-out driver screens need before anyone has a token, read from
// the public /auth/options. `forgotPasswordEnabled` is null until the answer
// arrives, so a screen can hold back instead of showing a link that then
// disappears, and true if the call fails: the server refuses a switched-off
// request itself, so a wrong guess here costs a message, not a reset email.
export function useAuthOptions() {
  const [options, setOptions] = useState({ forgotPasswordEnabled: null });

  useEffect(() => {
    let live = true;
    api
      .get("/auth/options")
      .then((o) => live && setOptions({ forgotPasswordEnabled: o.forgot_password_enabled !== false }))
      .catch(() => live && setOptions({ forgotPasswordEnabled: true }));
    return () => {
      live = false;
    };
  }, []);

  return options;
}
