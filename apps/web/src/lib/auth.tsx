import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  cleanDisplayName,
  isEmail,
  normalizeAuthError,
  validatePassword,
  validateUsername,
} from "./auth-utils";

export interface AuthUser {
  id: string;
  username: string;
  displayUsername: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  role: "USER" | "ADMIN" | string;
  badge: "SPECTATOR" | "ASSISTANT_REF" | "CHIEF_VAR" | string;
  tacticalIqScore: number;
  joinedAt?: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthResult>;
  signUp: (params: {
    name: string;
    username: string;
    email: string;
    password: string;
  }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<AuthResult>;
  changeEmail: (email: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  resetPassword: (token: string, newPassword: string) => Promise<AuthResult>;
  refreshUser: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const res = await fetch("/api/me", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        return data;
      }
      setUser(null);
      return null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();

    // Revalidate when window receives focus (e.g. after clicking confirmation link in inbox)
    const handleFocus = () => {
      refreshUser();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshUser]);

  const signIn = async (identifier: string, password: string): Promise<AuthResult> => {
    setError(null);
    const trimmedId = (identifier || "").trim();
    if (!trimmedId || !password) {
      const msg = "Please enter your email or username and password.";
      setError(msg);
      return { success: false, error: msg };
    }

    try {
      const endpoint = isEmail(trimmedId)
        ? "/api/auth/sign-in/email"
        : "/api/auth/sign-in/username";

      const body = isEmail(trimmedId)
        ? { email: trimmedId, password }
        : { username: trimmedId, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ status: res.status }));
        const normalized = normalizeAuthError(data);
        setError(normalized);
        return { success: false, error: normalized };
      }

      await refreshUser();
      return { success: true };
    } catch (err: any) {
      const normalized = normalizeAuthError(err);
      setError(normalized);
      return { success: false, error: normalized };
    }
  };

  const signUp = async ({
    name,
    username,
    email,
    password,
  }: {
    name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<AuthResult> => {
    setError(null);
    const cleanedName = cleanDisplayName(name);
    if (!cleanedName) {
      const msg = "Display name must be between 1 and 50 characters.";
      setError(msg);
      return { success: false, error: msg };
    }

    const usernameErr = validateUsername(username);
    if (usernameErr) {
      setError(usernameErr);
      return { success: false, error: usernameErr };
    }

    if (!isEmail(email)) {
      const msg = "Enter a valid email address.";
      setError(msg);
      return { success: false, error: msg };
    }

    const passwordErr = validatePassword(password);
    if (passwordErr) {
      setError(passwordErr);
      return { success: false, error: passwordErr };
    }

    try {
      const res = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: cleanedName,
          username: username.toLowerCase(),
          email,
          password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ status: res.status }));
        const normalized = normalizeAuthError(data);
        setError(normalized);
        return { success: false, error: normalized };
      }

      await refreshUser();
      return { success: true };
    } catch (err: any) {
      const normalized = normalizeAuthError(err);
      setError(normalized);
      return { success: false, error: normalized };
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
    } finally {
      setUser(null);
    }
  };

  const signOutEverywhere = async (): Promise<void> => {
    try {
      await fetch("/api/auth/revoke-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
    } finally {
      setUser(null);
    }
  };

  const updateDisplayName = async (name: string): Promise<AuthResult> => {
    const cleanedName = cleanDisplayName(name);
    if (!cleanedName) {
      return { success: false, error: "Display name must be between 1 and 50 characters." };
    }

    try {
      const res = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: cleanedName }),
      });
      if (!res.ok) {
        return { success: false, error: normalizeAuthError(await res.json().catch(() => null)) };
      }
      await refreshUser();
      return { success: true };
    } catch (err) {
      return { success: false, error: normalizeAuthError(err) };
    }
  };

  const changeEmail = async (email: string): Promise<AuthResult> => {
    const newEmail = email.trim().toLowerCase();
    if (!isEmail(newEmail)) {
      return { success: false, error: "Enter a valid email address." };
    }
    if (newEmail === user?.email.toLowerCase()) {
      return { success: false, error: "Enter a different email address." };
    }

    try {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newEmail }),
      });
      if (!res.ok) {
        return { success: false, error: normalizeAuthError(await res.json().catch(() => null)) };
      }
      await refreshUser();
      return { success: true };
    } catch (err) {
      return { success: false, error: normalizeAuthError(err) };
    }
  };

  const requestPasswordReset = async (email: string): Promise<AuthResult> => {
    setError(null);
    if (!isEmail(email)) {
      const msg = "Please enter a valid email address.";
      setError(msg);
      return { success: false, error: msg };
    }

    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ status: res.status }));
        const normalized = normalizeAuthError(data);
        setError(normalized);
        return { success: false, error: normalized };
      }

      return { success: true };
    } catch (err: any) {
      const normalized = normalizeAuthError(err);
      setError(normalized);
      return { success: false, error: normalized };
    }
  };

  const resetPassword = async (token: string, newPassword: string): Promise<AuthResult> => {
    setError(null);
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) {
      setError(passwordErr);
      return { success: false, error: passwordErr };
    }

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ status: res.status }));
        const normalized = normalizeAuthError(data);
        setError(normalized);
        return { success: false, error: normalized };
      }

      // Resetting password revokes other device sessions
      setUser(null);
      return { success: true };
    } catch (err: any) {
      const normalized = normalizeAuthError(err);
      setError(normalized);
      return { success: false, error: normalized };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signOut,
        signOutEverywhere,
        updateDisplayName,
        changeEmail,
        requestPasswordReset,
        resetPassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
