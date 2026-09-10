import { useEffect, useRef, useState } from "react";

// 通用确认弹层：替代原生 confirm()，样式与项目风格一致
export function ConfirmDialog({
  open,
  title,
  message,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="serif-title mb-2 text-base text-ink">{title}</h3>
        <p className="mb-5 text-sm leading-6 text-ink-2">{message}</p>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// 通用单行输入弹层：替代原生 prompt()
export function PromptDialog({
  open,
  title,
  label,
  defaultValue = "",
  placeholder,
  error,
  submitting = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  error?: string;
  submitting?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const v = value.trim();
    if (v && !submitting) onSubmit(v);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="serif-title mb-3 text-base text-ink">{title}</h3>
        {label && <label className="mb-1.5 block text-sm text-ink-2">{label}</label>}
        <input
          ref={inputRef}
          className="input"
          value={value}
          placeholder={placeholder}
          disabled={submitting}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape" && !submitting) onCancel();
          }}
        />
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={submitting}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={!value.trim() || submitting}>
            {submitting ? "创建中…" : "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
