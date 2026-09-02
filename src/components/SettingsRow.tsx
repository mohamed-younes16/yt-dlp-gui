import type { ReactNode } from "react";

export function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground line-clamp-1 text-xs">
          {description}
        </span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
