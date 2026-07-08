import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileCheck2, Send, ShieldCheck } from "lucide-react";
import { submitPartnerApplication } from "../../services/api";
import { PartnerApplicationStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import type { PartnerApplication, PartnerType } from "../../types/domain";

const toList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function ApplyPage() {
  const [partnerType, setPartnerType] = useState<PartnerType>("business");
  const [businessName, setBusinessName] = useState("AURA 성수 메이크업 스튜디오");
  const [ownerName, setOwnerName] = useState("김세아");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState("123-45-67890");
  const [phone, setPhone] = useState("02-468-1900");
  const [email, setEmail] = useState("pending@aura.example");
  const [specialties, setSpecialties] = useState("메이크업, 퍼스널컬러, 웨딩");
  const [categories, setCategories] = useState("퍼스널컬러, 메이크업");
  const [introduction, setIntroduction] = useState("앱 AI 리포트를 함께 보며 바로 따라 할 수 있는 메이크업 처방을 제공합니다.");
  const [price30Min, setPrice30Min] = useState(19000);
  const [price60Min, setPrice60Min] = useState(34000);
  const [businessRegistrationFileName, setBusinessRegistrationFileName] = useState("AURA성수_사업자등록증.pdf");
  const [beautyLicenseFileName, setBeautyLicenseFileName] = useState("김세아_국가미용사면허증.pdf");
  const [additionalCertificateFileNames, setAdditionalCertificateFileNames] = useState<string[]>(["퍼스널컬러컨설턴트1급.pdf"]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [submittedApplication, setSubmittedApplication] = useState<PartnerApplication | null>(null);

  const requiredDocumentsReady = useMemo(
    () => Boolean(businessRegistrationFileName && beautyLicenseFileName),
    [beautyLicenseFileName, businessRegistrationFileName],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const application = await submitPartnerApplication({
        partnerType,
        businessName,
        ownerName,
        businessRegistrationNumber,
        phone,
        email,
        specialties: toList(specialties),
        categories: toList(categories),
        introduction,
        price30Min,
        price60Min,
        businessRegistrationFileName,
        beautyLicenseFileName,
        additionalCertificateFileNames,
      });
      setSubmittedApplication(application);
    } finally {
      setSubmitting(false);
    }
  };

  const updateFileName = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.files?.[0]?.name ?? "");
  };

  const updateAdditionalFileNames = (event: ChangeEvent<HTMLInputElement>) => {
    setAdditionalCertificateFileNames(Array.from(event.target.files ?? []).map((file) => file.name));
  };

  if (submittedApplication) {
    return (
      <main className="login-page">
        <section className="login-panel login-panel-wide">
          <div className="application-result">
            <FileCheck2 size={34} />
            <span className="page-eyebrow">Application Submitted</span>
            <h1>입점 신청이 접수되었습니다</h1>
            <p>{submittedApplication.businessName}의 서류와 기본 정보가 관리자 검토 대기 상태로 등록되었습니다.</p>
            <div className="result-summary">
              <div>
                <span>신청 상태</span>
                <PartnerApplicationStatusBadge status={submittedApplication.status} />
              </div>
              <div>
                <span>제출 서류</span>
                <strong>{submittedApplication.documents.length}개</strong>
              </div>
              <div>
                <span>로그인 이메일</span>
                <strong>{submittedApplication.email}</strong>
              </div>
            </div>
            <div className="verification-note">
              <ShieldCheck size={18} />
              <div>
                <strong>승인 전 업체/전문가 상태</strong>
                <span>관리자 승인 전에는 예약·고객 운영 메뉴 대신 검토 상태만 확인하게 됩니다.</span>
              </div>
            </div>
            <div className="page-actions">
              <Link to="/login">
                <Button variant="secondary" icon={<ArrowLeft size={17} />}>
                  로그인 화면
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-panel login-panel-wide apply-panel">
        <div className="apply-header">
          <div>
            <span className="page-eyebrow">Partner Application</span>
            <h1>업체/전문가 입점 신청</h1>
            <p>신청자는 승인 전 업체/전문가 상태로 접수되며, 관리자 검토 후 운영 계정이 발급됩니다.</p>
          </div>
          <Link to="/login">
            <Button variant="ghost" icon={<ArrowLeft size={17} />}>
              로그인
            </Button>
          </Link>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="업체 유형">
              <SelectInput value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)}>
                <option value="business">사업자 업체</option>
                <option value="freelancer">프리랜서 전문가</option>
              </SelectInput>
            </Field>
            <Field label={partnerType === "business" ? "업체명" : "활동명"}>
              <TextInput value={businessName} onChange={(event) => setBusinessName(event.target.value)} required />
            </Field>
            <Field label="대표자명">
              <TextInput value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required />
            </Field>
            <Field label="사업자등록번호">
              <TextInput value={businessRegistrationNumber} onChange={(event) => setBusinessRegistrationNumber(event.target.value)} />
            </Field>
            <Field label="연락처">
              <TextInput value={phone} onChange={(event) => setPhone(event.target.value)} required />
            </Field>
            <Field label="이메일">
              <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </Field>
            <Field label="전문 분야" hint="쉼표로 구분">
              <TextInput value={specialties} onChange={(event) => setSpecialties(event.target.value)} />
            </Field>
            <Field label="상담 가능 카테고리" hint="쉼표로 구분">
              <TextInput value={categories} onChange={(event) => setCategories(event.target.value)} />
            </Field>
            <Field label="30분 상담 가격">
              <TextInput type="number" value={price30Min} onChange={(event) => setPrice30Min(Number(event.target.value))} min={0} />
            </Field>
            <Field label="1시간 상담 가격">
              <TextInput type="number" value={price60Min} onChange={(event) => setPrice60Min(Number(event.target.value))} min={0} />
            </Field>
            <Field label="소개 문구" hint="앱 전문가 상세에 노출될 수 있는 문장">
              <TextArea value={introduction} onChange={(event) => setIntroduction(event.target.value)} />
            </Field>
          </div>

          <div className="document-upload-grid">
            <Field label="사업자등록증 PDF">
              <input className="control" type="file" accept="application/pdf" onChange={updateFileName(setBusinessRegistrationFileName)} />
              <small>{businessRegistrationFileName || "PDF 파일을 선택하세요"}</small>
            </Field>
            <Field label="국가 미용사 면허증 PDF">
              <input className="control" type="file" accept="application/pdf" onChange={updateFileName(setBeautyLicenseFileName)} />
              <small>{beautyLicenseFileName || "PDF 파일을 선택하세요"}</small>
            </Field>
            <Field label="추가 자격증 PDF">
              <input className="control" type="file" accept="application/pdf" multiple onChange={updateAdditionalFileNames} />
              <small>{additionalCertificateFileNames.length ? additionalCertificateFileNames.join(", ") : "선택 사항"}</small>
            </Field>
          </div>

          <Button type="submit" variant="primary" icon={<Send size={17} />} disabled={isSubmitting || !requiredDocumentsReady}>
            {isSubmitting ? "제출 중" : "입점 신청 제출"}
          </Button>
        </form>
      </section>
    </main>
  );
}
