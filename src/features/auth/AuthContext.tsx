import { createContext, useContext, useMemo, useState } from "react";
import { completePartnerPasswordChange, mockLogin, type LoginRequest } from "../../services/api";
import type { AuthUser } from "../../types/domain";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (request: LoginRequest) => Promise<void>;
  completePasswordChange: (nextPassword: string) => Promise<void>;
  logout: () => void;
}

const STORAGE_KEY = "consultant-web-auth";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      login: async (request) => {
        const nextUser = await mockLogin(request);
        setUser(nextUser);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
      },
      completePasswordChange: async (nextPassword) => {
        if (!user?.accountId) {
          throw new Error("파트너 계정 정보가 없습니다.");
        }
        await completePartnerPasswordChange(user.accountId, nextPassword);
        const nextUser = { ...user, passwordChangeRequired: false };
        setUser(nextUser);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
      },
      logout: () => {
        setUser(null);
        window.localStorage.removeItem(STORAGE_KEY);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
