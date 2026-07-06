import { FormEvent, useState } from "react";
import { Building2, CheckCircle2, FileBadge2, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthContext";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextInput } from "../../shared/ui/Field";
import type { PartnerType, UserRole, WorkspaceScope } from "../../types/domain";

type EntryMode = "admin" | "partner";

export function LoginPage() {
  const { login } = useAuth();
  const [entryMode, setEntryMode] = useState<EntryMode>("partner");
  const [email, setEmail] = useState("partner@aura.example");
  const [role, setRole] = useState<UserRole>("business_manager");
  const [workspaceScope, setWorkspaceScope] = useState<WorkspaceScope>("business_operations");
  const [partnerType, setPartnerType] = useState<PartnerType>("business");
  const [businessName, setBusinessName] = useState("AURA 성수 메이크업 스튜디오");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState("123-45-67890");
  const [verificationFileName, setVerificationFileName] = useState("사업자등록증_AURA성수.pdf");
  const [isSubmitting, setSubmitting] = useState(false);

  const selectMode = (mode: EntryMode) => {
    setEntryMode(mode);
    if (mode === "admin") {
      setRole("admin");
      setWorkspaceScope("business_operations");
      setEmail("admin@aura.example");
    } else {
      setRole("business_manager");
      setWorkspaceScope("business_operations");
      setEmail("partner@aura.example");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login({
        email,
        role,
        workspaceScope,
        partnerType,
        businessName,
        businessRegistrationNumber,
        verificationFileName,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel login-panel-wide">
        <h1>AURA 파트너 매니저</h1>
        <p>뷰티 종합 플랫폼 앱에서 들어온 전문가 상담 예약, 리포트, 고객 대화, 정산과 업체 검수를 관리합니다.</p>

        <div className="entry-mode-grid" role="tablist" aria-label="입장 유형">
          <button className={`entry-mode ${entryMode === "admin" ? "is-active" : ""}`} type="button" onClick={() => selectMode("admin")}>
            <ShieldCheck size={22} />
            <strong>플랫폼 관리자</strong>
            <span>업체 검수, 전문가 노출, 신고/리뷰, 전체 운영을 확인합니다.</span>
          </button>
          <button className={`entry-mode ${entryMode === "partner" ? "is-active" : ""}`} type="button" onClick={() => selectMode("partner")}>
            <Building2 size={22} />
            <strong>업체/프리랜서 파트너</strong>
            <span>내 예약, 고객 리포트, 상담 완료 노트, 프로필과 정산을 관리합니다.</span>
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <Field label="이메일">
            <TextInput value={email} onChange={(event) => setEmail(event.target.value)} placeholder="partner@aura.example" />
          </Field>
          {entryMode === "partner" ? (
            <>
              <div className="form-grid">
                <Field label="파트너 유형">
                  <SelectInput value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)}>
                    <option value="business">사업자 업체</option>
                    <option value="freelancer">프리랜서 전문가</option>
                  </SelectInput>
                </Field>
                <Field label="워크스페이스">
                  <SelectInput value={workspaceScope} onChange={(event) => setWorkspaceScope(event.target.value as WorkspaceScope)}>
                    <option value="business_operations">업체 전체 운영</option>
                    <option value="expert_personal">전문가 개인 예약만</option>
                  </SelectInput>
                </Field>
              </div>
              <Field label={partnerType === "business" ? "업체명" : "활동명/전문가명"}>
                <TextInput value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
              </Field>
              <Field label={partnerType === "business" ? "사업자등록번호" : "신분/자격 확인 번호"}>
                <TextInput value={businessRegistrationNumber} onChange={(event) => setBusinessRegistrationNumber(event.target.value)} placeholder="123-45-67890" />
              </Field>
              <Field label={partnerType === "business" ? "사업자등록증 또는 통신판매업 증빙" : "자격증/신분 확인 증빙"}>
                <TextInput value={verificationFileName} onChange={(event) => setVerificationFileName(event.target.value)} placeholder="증빙 파일명.pdf" />
              </Field>
              <div className="verification-note">
                <FileBadge2 size={18} />
                <div>
                  <strong>Mock 인증 제출</strong>
                  <span>실서비스에서는 사업자등록증 OCR, 대표자 확인, 정산 계좌 검증, S3 presigned 업로드로 교체합니다.</span>
                </div>
              </div>
            </>
          ) : (
            <div className="verification-note">
              <CheckCircle2 size={18} />
              <div>
                <strong>관리자 모드</strong>
                <span>파트너 인증 상태, 앱 노출 상태, 리뷰/신고와 전체 상담 운영을 보는 내부 계정입니다.</span>
              </div>
            </div>
          )}
          <Button type="submit" variant="primary" icon={<LogIn size={17} />} disabled={isSubmitting}>
            {isSubmitting ? "로그인 중" : "Mock 로그인으로 입장"}
          </Button>
        </form>
        <div className="login-footer">
          지금은 프론트 mock입니다. 추후 FastAPI 인증, 관리자/파트너 권한, 사업자 검수 API, S3 업로드, 정산 계좌 인증으로 교체할 수 있도록 분리했습니다.
        </div>
      </section>
    </main>
  );
}
