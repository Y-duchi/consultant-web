import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, FilePlus2, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext";
import { Button } from "../../shared/ui/Button";
import { Field, TextInput } from "../../shared/ui/Field";

type EntryMode = "admin" | "partner" | "apply";

export function LoginPage() {
  const { login } = useAuth();
  const [entryMode, setEntryMode] = useState<EntryMode>("partner");
  const [adminEmail, setAdminEmail] = useState("admin@aura.example");
  const [partnerEmail, setPartnerEmail] = useState("seah.kim@aura-partner.local");
  const [password, setPassword] = useState("AuraSea!2026");
  const [error, setError] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (entryMode === "apply") return;
    setError("");
    setSubmitting(true);
    try {
      await login({
        email: entryMode === "admin" ? adminEmail : partnerEmail,
        password,
        role: entryMode === "admin" ? "admin" : "expert",
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel login-panel-wide">
        <h1>AURA 파트너 매니저</h1>
        <p>관리자는 입점 심사와 전체 운영을 보고, 승인된 업체/전문가는 예약·고객·상담 리포트를 관리합니다.</p>

        <div className="entry-mode-grid three" role="tablist" aria-label="입장 유형">
          <button className={`entry-mode ${entryMode === "admin" ? "is-active" : ""}`} type="button" onClick={() => setEntryMode("admin")}>
            <ShieldCheck size={22} />
            <strong>관리자 로그인</strong>
            <span>입점 신청 검토, 서류 확인, 승인과 계정 발급을 처리합니다.</span>
          </button>
          <button className={`entry-mode ${entryMode === "partner" ? "is-active" : ""}`} type="button" onClick={() => setEntryMode("partner")}>
            <Building2 size={22} />
            <strong>업체/전문가 로그인</strong>
            <span>승인된 계정으로 예약, 고객, 채팅, 리뷰와 프로필을 관리합니다.</span>
          </button>
          <button className={`entry-mode ${entryMode === "apply" ? "is-active" : ""}`} type="button" onClick={() => setEntryMode("apply")}>
            <FilePlus2 size={22} />
            <strong>입점 신청</strong>
            <span>승인 전 업체/전문가 상태로 서류와 기본 정보를 제출합니다.</span>
          </button>
        </div>

        {entryMode === "apply" ? (
          <div className="application-entry">
            <div className="verification-note">
              <FilePlus2 size={18} />
              <div>
                <strong>사업자등록증과 국가 미용사 면허증 PDF가 필요합니다</strong>
                <span>신청 후에는 관리자 검토 상태만 확인할 수 있고, 승인 후 운영 계정이 발급됩니다.</span>
              </div>
            </div>
            <Link to="/apply">
              <Button variant="primary" icon={<FilePlus2 size={17} />}>
                입점 신청서 작성
              </Button>
            </Link>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <Field label="이메일">
              <TextInput
                type="email"
                value={entryMode === "admin" ? adminEmail : partnerEmail}
                onChange={(event) => (entryMode === "admin" ? setAdminEmail(event.target.value) : setPartnerEmail(event.target.value))}
              />
            </Field>
            <Field label={entryMode === "admin" ? "관리자 비밀번호" : "임시 비밀번호"}>
              <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            {entryMode === "partner" ? (
              <div className="verification-note">
                <KeyRound size={18} />
                <div>
                  <strong>승인 전 이메일로 로그인하면 심사 상태 화면으로 이동합니다</strong>
                  <span>등록된 프리랜서별 발급 계정으로 로그인하면 실제 앱 예약·고객·채팅 데이터가 표시됩니다.</span>
                </div>
              </div>
            ) : null}
            {error ? <div className="form-error">{error}</div> : null}
            <Button type="submit" variant="primary" icon={<LogIn size={17} />} disabled={isSubmitting}>
              {isSubmitting ? "로그인 중" : "로그인"}
            </Button>
          </form>
        )}
        <div className="login-footer">
          파트너와 관리자 화면은 FastAPI 백엔드의 실제 운영 데이터를 기준으로 표시됩니다.
        </div>
      </section>
    </main>
  );
}
