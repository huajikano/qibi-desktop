import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, UserPlus } from "lucide-react";
import { useAuth } from "../stores/auth";

export default function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const register = useAuth((s) => s.register);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      await register(username.trim(), password);
      nav("/author", { replace: true });
    } catch (err: any) {
      setError(err.message || "注册失败");
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
        <h1 className="serif-title text-2xl text-ink">成为作者</h1>
        <p className="mt-1 text-sm text-ink-2">创建账号，开启你的创作之旅</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div>
          <label className="mb-1.5 block text-sm text-ink-2" htmlFor="username">
            用户名 <span className="text-primary-2">*</span>
          </label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="2-20 位中文、字母、数字或下划线"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-2" htmlFor="password">
            密码 <span className="text-primary-2">*</span>
          </label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="至少 6 位"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-ink-2" htmlFor="confirm">
            确认密码 <span className="text-primary-2">*</span>
          </label>
          <input
            id="confirm"
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="再次输入密码"
            required
          />
        </div>
        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "注册中…" : "注册并进入写作台"}
          {!busy && <UserPlus size={16} />}
        </button>
        <p className="text-center text-sm text-ink-3">
          已有账号？
          <Link to="/login" className="ml-1 text-link hover:underline">
            直接登录
          </Link>
        </p>
      </form>
    </div>
  );
}
