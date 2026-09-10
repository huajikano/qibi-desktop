import { useEffect, useState } from "react";
import { Shield, Users, BookOpen, FileText, Map as MapIcon, PersonStanding, KeyRound } from "lucide-react";
import { api } from "../api";

interface Stats {
  users: number; novels: number; chapters: number; characters: number; maps: number; words: number; stationKeyConfigured: boolean;
}
interface AdminUser {
  id: number; username: string; role: string; created_at: string; novel_count: number; chapter_count: number; ai_api_key_enabled: number; disabled: number;
}

export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const load = async () => {
    const [s, u] = await Promise.all([api.get<Stats>("/admin/stats"), api.get<AdminUser[]>("/admin/users")]);
    setStats(s);
    setUsers(u);
  };
  useEffect(() => {
    void load();
  }, []);

  const toggleRole = async (u: AdminUser) => {
    await api.patch(`/admin/users/${u.id}`, { role: u.role === "admin" ? "author" : "admin" });
    await load();
  };

  const toggleDisable = async (u: AdminUser) => {
    if (!confirm(`确定${u.disabled ? "恢复" : "停用"}用户「${u.username}」？`)) return;
    await api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled });
    await load();
  };

  const cards: { label: string; value: number; icon: typeof Users; color: string }[] = stats
    ? [
        { label: "用户", value: stats.users, icon: Users, color: "text-link" },
        { label: "作品", value: stats.novels, icon: BookOpen, color: "text-primary-2" },
        { label: "章节", value: stats.chapters, icon: FileText, color: "text-emerald-400" },
        { label: "人物", value: stats.characters, icon: PersonStanding, color: "text-purple-400" },
        { label: "地图", value: stats.maps, icon: MapIcon, color: "text-gold" },
        { label: "总字数", value: stats.words, icon: FileText, color: "text-sky-400" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="serif-title flex items-center gap-2 text-2xl text-ink">
        <Shield className="text-primary-2" size={22} /> 管理后台
      </h1>

      {/* 统计 */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4 text-center">
            <c.icon className={`mx-auto mb-2 ${c.color}`} size={20} />
            <p className="font-mono text-2xl tabular-nums text-ink">{c.value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-ink-3">{c.label}</p>
          </div>
        ))}
      </div>
      {stats && (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-3">
          <KeyRound size={12} className={stats.stationKeyConfigured ? "text-emerald-400" : "text-ink-3"} />
          {stats.stationKeyConfigured ? "站方 AI 密钥：已配置" : "站方 AI 密钥：未配置（用户需自填密钥）"}
        </p>
      )}

      {/* 用户管理 */}
      <h2 className="serif-title mt-8 mb-3 text-lg text-ink">用户管理</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-3">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户名</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">作品/章节</th>
              <th className="px-4 py-3">AI 密钥</th>
              <th className="px-4 py-3">注册时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink-3">{u.id}</td>
                <td className="px-4 py-3 text-ink">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${u.role === "admin" ? "bg-gold/15 text-gold" : "bg-primary-soft text-primary-2"}`}>
                    {u.role === "admin" ? "管理员" : "作者"}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-2">{u.novel_count} / {u.chapter_count}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${u.ai_api_key_enabled ? "text-emerald-400" : "text-ink-3"}`}>
                    {u.ai_api_key_enabled ? "已配置" : "—"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-3">{u.created_at.slice(0, 10)}</td>
                <td className="px-4 py-3 text-right">
                  {u.id !== 1 && (
                    <div className="flex justify-end gap-2">
                      <button className="btn-ghost !min-h-7 !px-2 text-[11px]" onClick={() => void toggleRole(u)}>
                        {u.role === "admin" ? "降为作者" : "设为管理员"}
                      </button>
                      <button
                        className={`!min-h-7 !px-2 text-[11px] ${u.disabled ? "btn-ghost" : "btn-danger"}`}
                        onClick={() => void toggleDisable(u)}
                      >
                        {u.disabled ? "恢复" : "停用"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
