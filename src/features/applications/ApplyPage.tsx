import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileCheck2, MailCheck, MapPin, Send, ShieldCheck, Video } from "lucide-react";
import {
  confirmPartnerEmailVerification,
  requestPartnerEmailVerification,
  submitPartnerApplication,
  uploadPartnerApplicationDocument,
  uploadPartnerApplicationProfileImage,
} from "../../services/api";
import { PartnerApplicationStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import type { ConsultingMode, PartnerApplication, PartnerType } from "../../types/domain";

const toList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const normalizePriceInput = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
};

export function ApplyPage() {
  const [partnerType, setPartnerType] = useState<PartnerType>("business");
  const [businessName, setBusinessName] = useState("AURA 성수 메이크업 스튜디오");
  const [ownerName, setOwnerName] = useState("김세아");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState("123-45-67890");
  const [phone, setPhone] = useState("02-468-1900");
  const [email, setEmail] = useState("");
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [emailVerificationToken, setEmailVerificationToken] = useState("");
  const [emailVerificationMessage, setEmailVerificationMessage] = useState("");
  const [emailVerificationError, setEmailVerificationError] = useState("");
  const [isSendingVerification, setSendingVerification] = useState(false);
  const [isConfirmingVerification, setConfirmingVerification] = useState(false);
  const [specialties, setSpecialties] = useState("메이크업, 퍼스널컬러, 웨딩");
  const [categories, setCategories] = useState("퍼스널컬러, 메이크업");
  const [introduction, setIntroduction] = useState("앱 AI 리포트를 함께 보며 바로 따라 할 수 있는 메이크업 처방을 제공합니다.");
  const [consultingModes, setConsultingModes] = useState<ConsultingMode[]>(["online"]);
  const [onlinePrice30Min, setOnlinePrice30Min] = useState("19000");
  const [onlinePrice60Min, setOnlinePrice60Min] = useState("34000");
  const [offlinePrice30Min, setOfflinePrice30Min] = useState("29000");
  const [offlinePrice60Min, setOfflinePrice60Min] = useState("49000");
  const [offlineAddress, setOfflineAddress] = useState("서울 성동구 연무장길 8");
  const [offlineDetailAddress, setOfflineDetailAddress] = useState("3층 AURA 상담룸");
  const [offlineLocationNote, setOfflineLocationNote] = useState("성수역 3번 출구 도보 4분, 건물 뒤편 유료 주차 가능");
  const [businessRegistrationFile, setBusinessRegistrationFile] = useState<File | null>(null);
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [beautyLicenseFile, setBeautyLicenseFile] = useState<File | null>(null);
  const [additionalCertificateFiles, setAdditionalCertificateFiles] = useState<File[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submittedApplication, setSubmittedApplication] = useState<PartnerApplication | null>(null);
  const hasOnlineConsulting = consultingModes.includes("online");
  const hasOfflineConsulting = consultingModes.includes("offline");

  const businessRegistrationFileName = businessRegistrationFile?.name ?? "";
  const beautyLicenseFileName = beautyLicenseFile?.name ?? "";
  const additionalCertificateFileNames = additionalCertificateFiles.map((file) => file.name);
  const requiredDocumentsReady = Boolean(businessRegistrationFile && profileImageFile);
  const requiredPricesReady = (
    (!hasOnlineConsulting || (onlinePrice30Min !== "" && onlinePrice60Min !== ""))
    && (!hasOfflineConsulting || (offlinePrice30Min !== "" && offlinePrice60Min !== ""))
  );
  const requiredProfileReady = Boolean(businessName.trim() && ownerName.trim() && phone.trim());
  const canSubmit = Boolean(emailVerificationToken)
    && requiredProfileReady
    && requiredDocumentsReady
    && requiredPricesReady
    && consultingModes.length > 0
    && (!hasOfflineConsulting || offlineAddress.trim().length > 0);

  const updateEmail = (value: string) => {
    setEmail(value);
    setEmailVerificationCode("");
    setEmailVerificationToken("");
    setEmailVerificationMessage("");
    setEmailVerificationError("");
  };

  const sendVerificationCode = async () => {
    if (!email.trim()) return;
    setSendingVerification(true);
    setEmailVerificationError("");
    setEmailVerificationMessage("");
    setEmailVerificationToken("");
    try {
      const result = await requestPartnerEmailVerification(email);
      setEmailVerificationMessage(`인증 코드를 보냈습니다. ${result.expiresInMinutes}분 안에 입력해 주세요.`);
    } catch (error) {
      setEmailVerificationError(error instanceof Error ? error.message : "인증 메일을 보내지 못했습니다.");
    } finally {
      setSendingVerification(false);
    }
  };

  const confirmVerificationCode = async () => {
    if (emailVerificationCode.length !== 6) return;
    setConfirmingVerification(true);
    setEmailVerificationError("");
    try {
      const result = await confirmPartnerEmailVerification(email, emailVerificationCode);
      setEmailVerificationToken(result.verificationToken);
      setEmailVerificationMessage("이메일 인증이 완료되었습니다.");
    } catch (error) {
      setEmailVerificationToken("");
      setEmailVerificationError(error instanceof Error ? error.message : "인증 코드를 확인하지 못했습니다.");
    } finally {
      setConfirmingVerification(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !businessRegistrationFile || !profileImageFile) return;
    setSubmitting(true);
    setSubmissionError("");
    try {
      const [profileImageStorageKey, businessRegistrationStorageKey, beautyLicenseStorageKey, additionalCertificateStorageKeys] = await Promise.all([
        uploadPartnerApplicationProfileImage(profileImageFile),
        uploadPartnerApplicationDocument(businessRegistrationFile, "business_registration"),
        beautyLicenseFile
          ? uploadPartnerApplicationDocument(beautyLicenseFile, "beauty_license")
          : Promise.resolve(undefined),
        Promise.all(
          additionalCertificateFiles.map((file) => uploadPartnerApplicationDocument(file, "additional_certificate")),
        ),
      ]);
      const application = await submitPartnerApplication({
        partnerType,
        businessName,
        ownerName,
        businessRegistrationNumber,
        phone,
        email,
        emailVerificationToken,
        specialties: toList(specialties),
        categories: toList(categories),
        introduction,
        consultingModes,
        price30Min: Number(hasOnlineConsulting ? onlinePrice30Min : offlinePrice30Min),
        price60Min: Number(hasOnlineConsulting ? onlinePrice60Min : offlinePrice60Min),
        onlinePrice30Min: hasOnlineConsulting ? Number(onlinePrice30Min) : undefined,
        onlinePrice60Min: hasOnlineConsulting ? Number(onlinePrice60Min) : undefined,
        offlinePrice30Min: hasOfflineConsulting ? Number(offlinePrice30Min) : undefined,
        offlinePrice60Min: hasOfflineConsulting ? Number(offlinePrice60Min) : undefined,
        offlineAddress: hasOfflineConsulting ? offlineAddress : undefined,
        offlineDetailAddress: hasOfflineConsulting ? offlineDetailAddress : undefined,
        offlineLocationNote: hasOfflineConsulting ? offlineLocationNote : undefined,
        profileImageFileName: profileImageFile.name,
        profileImageStorageKey,
        profileImageContentType: profileImageFile.type,
        businessRegistrationFileName,
        businessRegistrationStorageKey,
        beautyLicenseFileName,
        beautyLicenseStorageKey,
        additionalCertificateFileNames,
        additionalCertificateStorageKeys,
      });
      setSubmittedApplication(application);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "입점 신청 제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateFile = (setter: (value: File | null) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.files?.[0] ?? null);
  };

  const updateAdditionalFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setAdditionalCertificateFiles(Array.from(event.target.files ?? []));
  };

  const toggleConsultingMode = (mode: ConsultingMode) => {
    setConsultingModes((current) =>
      current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode],
    );
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
                <span>상담 방식</span>
                <strong>{(submittedApplication.consultingModes ?? ["online"]).map(consultingModeLabel).join(" · ")}</strong>
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
                <span>접수 확인과 심사 결과를 인증한 이메일로 안내합니다. 관리자 승인 전에는 검토 상태만 확인할 수 있습니다.</span>
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
            <Field label="업체 유형" required>
              <SelectInput value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)} required>
                <option value="business">사업자 업체</option>
                <option value="freelancer">프리랜서 전문가</option>
              </SelectInput>
            </Field>
            <Field label={partnerType === "business" ? "업체명" : "활동명"} required>
              <TextInput value={businessName} onChange={(event) => setBusinessName(event.target.value)} required />
            </Field>
            <Field label="대표자명" required>
              <TextInput value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required />
            </Field>
            <Field label="사업자등록번호">
              <TextInput value={businessRegistrationNumber} onChange={(event) => setBusinessRegistrationNumber(event.target.value)} />
            </Field>
            <Field label="연락처" required>
              <TextInput value={phone} onChange={(event) => setPhone(event.target.value)} required />
            </Field>
            <div className="field span-2">
              <span>이메일 인증<span className="field-required" aria-hidden="true">*</span></span>
              <div className="email-verification-row">
                <TextInput type="email" value={email} onChange={(event) => updateEmail(event.target.value)} required disabled={Boolean(emailVerificationToken)} />
                <Button type="button" variant="secondary" icon={<Send size={16} />} onClick={sendVerificationCode} disabled={!email.trim() || isSendingVerification || Boolean(emailVerificationToken)}>
                  {isSendingVerification ? "전송 중" : "인증 코드 전송"}
                </Button>
              </div>
              {emailVerificationMessage && !emailVerificationToken ? (
                <div className="email-verification-row">
                  <TextInput inputMode="numeric" maxLength={6} value={emailVerificationCode} onChange={(event) => setEmailVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6자리 인증 코드" />
                  <Button type="button" variant="secondary" icon={<MailCheck size={16} />} onClick={confirmVerificationCode} disabled={emailVerificationCode.length !== 6 || isConfirmingVerification}>
                    {isConfirmingVerification ? "확인 중" : "인증 확인"}
                  </Button>
                </div>
              ) : null}
              {emailVerificationMessage ? <small className={emailVerificationToken ? "verification-success" : ""}>{emailVerificationMessage}</small> : null}
              {emailVerificationError ? <small className="verification-error">{emailVerificationError}</small> : null}
            </div>
            <Field label="전문 분야" hint="쉼표로 구분">
              <TextInput value={specialties} onChange={(event) => setSpecialties(event.target.value)} />
            </Field>
            <Field label="상담 가능 카테고리" hint="쉼표로 구분">
              <TextInput value={categories} onChange={(event) => setCategories(event.target.value)} />
            </Field>
            <div className="field span-2">
              <span>상담 방식<span className="field-required" aria-hidden="true">*</span></span>
              <div className="mode-option-grid">
                <label className={`mode-option ${hasOnlineConsulting ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={hasOnlineConsulting}
                    onChange={() => toggleConsultingMode("online")}
                  />
                  <Video size={17} />
                  <span>
                    <strong>온라인</strong>
                    <small>앱 영상 상담</small>
                  </span>
                </label>
                <label className={`mode-option ${hasOfflineConsulting ? "selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={hasOfflineConsulting}
                    onChange={() => toggleConsultingMode("offline")}
                  />
                  <MapPin size={17} />
                  <span>
                    <strong>오프라인</strong>
                    <small>매장 방문 상담</small>
                  </span>
                </label>
              </div>
            </div>
            {hasOnlineConsulting ? (
              <>
                <Field label="온라인 30분 가격" required>
                  <TextInput type="text" inputMode="numeric" pattern="[0-9]*" value={onlinePrice30Min} onChange={(event) => setOnlinePrice30Min(normalizePriceInput(event.target.value))} required />
                </Field>
                <Field label="온라인 1시간 가격" required>
                  <TextInput type="text" inputMode="numeric" pattern="[0-9]*" value={onlinePrice60Min} onChange={(event) => setOnlinePrice60Min(normalizePriceInput(event.target.value))} required />
                </Field>
              </>
            ) : null}
            {hasOfflineConsulting ? (
              <>
                <Field label="오프라인 30분 가격" required>
                  <TextInput type="text" inputMode="numeric" pattern="[0-9]*" value={offlinePrice30Min} onChange={(event) => setOfflinePrice30Min(normalizePriceInput(event.target.value))} required />
                </Field>
                <Field label="오프라인 1시간 가격" required>
                  <TextInput type="text" inputMode="numeric" pattern="[0-9]*" value={offlinePrice60Min} onChange={(event) => setOfflinePrice60Min(normalizePriceInput(event.target.value))} required />
                </Field>
                <Field label="오프라인 주소" hint="방문 상담을 제공하는 경우 필수" required>
                  <TextInput value={offlineAddress} onChange={(event) => setOfflineAddress(event.target.value)} required={hasOfflineConsulting} />
                </Field>
                <Field label="상세 주소">
                  <TextInput value={offlineDetailAddress} onChange={(event) => setOfflineDetailAddress(event.target.value)} />
                </Field>
                <Field label="위치/방문 안내" hint="역 출구, 주차, 출입 안내 등">
                  <TextInput value={offlineLocationNote} onChange={(event) => setOfflineLocationNote(event.target.value)} />
                </Field>
              </>
            ) : null}
            <Field className="span-2 application-introduction-field" label="소개 문구" hint="앱 전문가 상세에 노출될 수 있는 문장">
              <TextArea value={introduction} onChange={(event) => setIntroduction(event.target.value)} />
            </Field>
          </div>

          <div className="document-upload-grid">
            <Field label="프로필 사진" required>
              <input className="control" type="file" accept="image/jpeg,image/png,image/webp" required onChange={updateFile(setProfileImageFile)} />
            </Field>
            <Field label="사업자등록증 PDF" required>
              <input className="control" type="file" accept="application/pdf" required onChange={updateFile(setBusinessRegistrationFile)} />
            </Field>
            <Field label="국가 미용사 면허증 PDF">
              <input className="control" type="file" accept="application/pdf" onChange={updateFile(setBeautyLicenseFile)} />
            </Field>
            <Field label="추가 자격증 PDF">
              <input className="control" type="file" accept="application/pdf" multiple onChange={updateAdditionalFiles} />
            </Field>
          </div>

          {submissionError ? <div className="form-error">{submissionError}</div> : null}
          <Button type="submit" variant="primary" icon={<Send size={17} />} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? "파일 업로드 및 제출 중" : "입점 신청 제출"}
          </Button>
        </form>
      </section>
    </main>
  );
}

function consultingModeLabel(mode: ConsultingMode) {
  return mode === "offline" ? "오프라인" : "온라인";
}
