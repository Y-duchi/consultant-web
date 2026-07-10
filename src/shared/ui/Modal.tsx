import { X } from "lucide-react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  title: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}

export function Modal({ bodyClassName = "", className = "", open, title, children, footer, onClose }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label="닫기" onClick={onClose} />
      <section className={`modal-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <Button className="dialog-close-button" variant="ghost" icon={<X size={17} />} onClick={onClose} aria-label="닫기">
            닫기
          </Button>
        </header>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
