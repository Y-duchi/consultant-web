import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "./Button";

export function LoadingState({ label = "데이터를 불러오는 중입니다" }: { label?: string }) {
  return (
    <div className="state-view">
      <Loader2 className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="state-view state-empty">
      <Inbox size={22} />
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-view state-error">
      <AlertTriangle size={22} />
      <strong>문제가 발생했습니다</strong>
      <span>{message}</span>
      {onRetry ? <Button onClick={onRetry}>다시 시도</Button> : null}
    </div>
  );
}
