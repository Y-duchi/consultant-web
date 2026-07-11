import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FieldProps {
  className?: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({ children, className = "", hint, label, required = false }: FieldProps) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>
        {label}
        {required ? <span className="field-required" aria-hidden="true">*</span> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`control ${className}`} {...props} />;
}

export function SelectInput({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`control ${className}`} {...props} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`control textarea ${className}`} {...props} />;
}
