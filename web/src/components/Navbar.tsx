import { Link, NavLink, useNavigate } from "react-router-dom";
import { BookOpen, PenLine, LogOut, Settings as SettingsIcon, Shield, Sparkles } from "lucide-react";
import { useAuth } from "../stores/auth";

export default function Navbar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/75 backdrop-blur-xl shadow-sm transition-all">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2.5 transition-transform hover:scale-[1.01]">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary via-primary-2 to-[#ff5967] shadow-[0_2px_10px_rgba(230,0,18,0.35)]">
            <BookOpen size={17} className="text-white drop-shadow-sm" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400"></span>
            </span>
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="serif-title text-lg font-bold tracking-wide text-ink group-hover:text-white transition-colors">
                起笔
              </span>
              <span className="hidden rounded-full border border-border bg-surface-2 px-1.5 py-0.2 text-[9px] font-medium text-gold sm:inline-flex items-center gap-0.5">
                <Sparkles size={9} /> NovelForge
              </span>
            </div>
            <span className="hidden text-[10px] font-normal tracking-widest text-ink-3 sm:block -mt-1">
              以笔为舟 · 渡万里山河
            </span>
          </div>
        </Link>

        <nav className="ml-6 flex items-center gap-1.5 text-sm font-medium">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `relative rounded-lg px-3 py-1.5 transition-all duration-150 ${
                isActive
                  ? "bg-surface-2 text-primary-2 shadow-sm font-semibold"
                  : "text-ink-2 hover:bg-surface-1 hover:text-ink"
              }`
            }
          >
            书库
          </NavLink>
          {user && (
            <NavLink
              to="/author"
              className={({ isActive }) =>
                `relative rounded-lg px-3 py-1.5 transition-all duration-150 ${
                  isActive
                    ? "bg-surface-2 text-primary-2 shadow-sm font-semibold"
                    : "text-ink-2 hover:bg-surface-1 hover:text-ink"
                }`
              }
            >
              写作台
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link to="/author" className="btn-primary hidden !min-h-8 !px-3 text-xs sm:inline-flex shadow-sm">
                <PenLine size={13} />
                进入创作
              </Link>
              {user.role === "admin" && (
                <Link to="/admin" className="btn-ghost !min-h-8 !px-2.5 text-xs text-gold hover:text-gold hover:bg-gold/10" title="管理中心">
                  <Shield size={14} />
                  <span className="hidden md:inline">管理</span>
                </Link>
              )}
              <Link to="/settings" className="btn-ghost !min-h-8 !px-2.5 text-xs" title="API 与智能体设置">
                <SettingsIcon size={14} />
              </Link>
              <button
                className="btn-ghost !min-h-8 !px-2.5 text-xs hover:text-rose-400"
                onClick={async () => {
                  await logout();
                  nav("/");
                }}
                title="退出登录"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline font-mono text-[11px]">{user.username}</span>
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost !min-h-8 !px-3.5 text-xs">
                登录
              </Link>
              <Link to="/register" className="btn-primary !min-h-8 !px-4 text-xs">
                免费注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
