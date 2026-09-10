import { create } from "zustand";
import { api } from "../api";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  loading: boolean;
  fetchMe: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  fetchMe: async () => {
    try {
      const { user } = await api.get<{ user: User | null }>("/auth/me");
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  login: async (username, password) => {
    const { user } = await api.post<{ user: User }>("/auth/login", { username, password });
    set({ user });
  },
  register: async (username, password) => {
    const { user } = await api.post<{ user: User }>("/auth/register", { username, password });
    set({ user });
  },
  logout: async () => {
    await api.post("/auth/logout");
    set({ user: null });
  },
}));
