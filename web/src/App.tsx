import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { useAuth } from "./stores/auth";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import BookDetail from "./pages/BookDetail";
import Reader from "./pages/Reader";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Bookshelf from "./pages/author/Bookshelf";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import RequireAuth from "./components/RequireAuth";

// 重组件按路由懒加载
const Workspace = lazy(() => import("./pages/author/Workspace"));
const Characters = lazy(() => import("./pages/author/Characters"));
const MapEditor = lazy(() => import("./pages/author/MapEditor"));
const DistillAuthor = lazy(() => import("./pages/author/DistillAuthor"));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[50vh] place-items-center text-ink-2">
          <div className="flex flex-col items-center gap-3">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm">加载工作台…</span>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  const fetchMe = useAuth((s) => s.fetchMe);
  const { pathname } = useLocation();
  const isEditorRoute = /^\/author\/book\/[^/]+(?:\/characters|\/map)?$/.test(pathname);
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return (
    <div className={isEditorRoute ? "flex h-dvh flex-col overflow-hidden" : "min-h-dvh flex flex-col"}>
      <Navbar />
      <main className={isEditorRoute ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "flex-1"}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:id" element={<BookDetail />} />
          <Route path="/read/:id" element={<Reader />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
          <Route path="/author" element={<RequireAuth><Bookshelf /></RequireAuth>} />
          <Route
            path="/author/distill"
            element={<RequireAuth><Lazy><DistillAuthor /></Lazy></RequireAuth>}
          />
          <Route
            path="/author/book/:id"
            element={<RequireAuth><Lazy><Workspace /></Lazy></RequireAuth>}
          />
          <Route
            path="/author/book/:id/characters"
            element={<RequireAuth><Lazy><Characters /></Lazy></RequireAuth>}
          />
          <Route
            path="/author/book/:id/map"
            element={<RequireAuth><Lazy><MapEditor /></Lazy></RequireAuth>}
          />
        </Routes>
      </main>
      {!isEditorRoute && (
        <footer className="border-t border-border py-6 text-center text-xs text-ink-3">
          起笔 · 小说创作与阅读平台 — 以笔为舟，渡万里山河
        </footer>
      )}
    </div>
  );
}
