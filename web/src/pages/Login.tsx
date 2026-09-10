import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, LogIn } from "lucide-react";
import { useAuth } from "../stores/auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const login = useAuth((s) => s.login);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string })?.from || "/author";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      nav(from, { replace: true });
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary-2">
          <BookOpen size={24} className="text-white" />
        </span>
        <h1 className="serif-title text-2xl text-ink">欢迎回到起笔</h1>
        <p className="mt-1 text-sm text-ink-2">登录你的写作工作台</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="mb-1.5 block text-sm text-ink-2" htmlFor="username">
            用户名
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="请输入用户名"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-2" htmlFor="password">
            密码
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
            required
          />
        </div>
        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "登录中…" : "登录"}
          {!busy && <LogIn size={16} />}
        </button>
        <p className="text-center text-sm text-ink-3">
          还没有账号？
          <Link to="/register" className="ml-1 text-link hover:underline">
            立即注册
          </Link>
        </p>
      </form>
    </div>
  );
}
