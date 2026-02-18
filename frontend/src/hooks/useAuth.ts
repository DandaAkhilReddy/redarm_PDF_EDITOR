import { useState, useCallback, useEffect } from "react";
import { apiJson } from "../lib/api";
import type { AuthState, LoginResponse } from "../types";

const STORAGE_KEY = "redarm_auth";

function loadSession(): AuthState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AuthState;
      if (parsed.token) return { ...parsed, isAuthenticated: true };
    }
  } catch { /* ignore */ }
  return { token: "", email: "", role: "", isAuthenticated: false };
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(loadSession);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (auth.isAuthenticated) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [auth]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoggingIn(true);
    try {
      const res = await apiJson<LoginResponse>("/auth/login", "POST", "", { email, password });
      const next: AuthState = {
        token: res.accessToken,
        email: res.user.email,
        role: res.user.role,
        isAuthenticated: true,
      };
      setAuth(next);
      return next;
    } finally {
      setIsLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    setAuth({ token: "", email: "", role: "", isAuthenticated: false });
  }, []);

  return { auth, login, logout, isLoggingIn };
}
