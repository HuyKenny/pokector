import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const styles = {
    primary:
      "bg-accent text-(color:--color-on-accent) hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed",
    secondary:
      "border border-edge bg-surface text-fg hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed",
    danger:
      "bg-negative text-(color:--color-on-accent) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
    ghost: "text-fg-muted hover:text-fg hover:bg-surface-raised",
  }[variant];
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({
  label,
  id,
  error,
  hint,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"input"> & {
  label: string;
  id: string;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`min-h-11 rounded-lg border border-edge bg-surface px-3 py-2 text-fg placeholder:text-fg-faint ${className}`}
        {...props}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-negative/40 bg-secondary-soft text-fg",
    success: "border-positive/40 bg-accent-soft text-fg",
    warning: "border-warning/40 bg-surface-raised text-fg",
    info: "border-edge bg-surface-raised text-fg",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-(--radius-card) border border-edge bg-surface p-6 shadow-(--shadow-card) ${className}`}
    >
      {children}
    </div>
  );
}
