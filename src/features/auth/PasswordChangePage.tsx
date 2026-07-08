import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext";
import { Button } from "../../shared/ui/Button";
import { Field, TextInput } from "../../shared/ui/Field";

export function PasswordChangePage() {
  const { completePasswordChange, logout, user } = useAuth();
  const navigate = useNavigate();
  const [nextPassword, setNextPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  if (!user?.passwordChangeRequired) {
    return <Navigate to="/workspace" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (nextPassword.trim().length < 8) {
      setError("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (nextPassword !== confirmation) {
      setError("새 비밀번호와 확인값이 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    try {
      await completePasswordChange(nextPassword);
      navigate("/workspace", { replace: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel password-change-panel">
        <div className="status-icon success">
          <KeyRound size={24} />
        </div>
        <h1>새 비밀번호 설정</h1>
        <p>임시 비밀번호 계정은 운영 워크스페이스에 들어가기 전에 새 비밀번호를 설정해야 합니다.</p>

        <div className="verification-note">
          <ShieldCheck size={18} />
          <div>
            <strong>{user.email}</strong>
            <span>설정 완료 전까지 예약, 고객, 채팅, 요약 화면 접근이 제한됩니다.</span>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <Field label="새 비밀번호">
            <TextInput type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
          </Field>
          <Field label="새 비밀번호 확인">
            <TextInput type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </Field>
          {error ? <div className="form-error">{error}</div> : null}
          <Button type="submit" variant="primary" icon={<CheckCircle2 size={17} />} disabled={isSubmitting}>
            {isSubmitting ? "설정 중" : "비밀번호 설정 완료"}
          </Button>
          <Button type="button" variant="ghost" icon={<LogOut size={17} />} onClick={logout}>
            다른 계정으로 로그인
          </Button>
        </form>
      </section>
    </main>
  );
}
