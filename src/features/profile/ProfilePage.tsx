import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Send } from "lucide-react";
import {
  getBusinessProfile,
  getExperts,
  getProfileChangeRequests,
  submitProfileChangeRequest,
} from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import {
  BusinessVerificationBadge,
  ExposureStatusBadge,
  ProfileChangeStatusBadge,
} from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatCurrency, formatDate, formatDateTime } from "../../shared/utils/format";
import type {
  BusinessProfile,
  Expert,
  ExposureStatus,
  PartnerType,
  ProfileChangeRequest,
  ProfileChangeTarget,
} from "../../types/domain";

export function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const businessQuery = useQuery({
    queryKey: ["business-profile", user?.businessId],
    queryFn: () => getBusinessProfile(user ?? undefined),
  });
  const expertsQuery = useQuery({
    queryKey: ["experts", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getExperts(user ?? undefined),
  });
  const requestsQuery = useQuery({
    queryKey: ["profile-change-requests", user?.id],
    queryFn: () => getProfileChangeRequests(user ?? undefined),
  });
  const [businessDraft, setBusinessDraft] = useState<Partial<BusinessProfile>>({});
  const [selectedExpertId, setSelectedExpertId] = useState("");
  const [expertDraft, setExpertDraft] = useState<Partial<Expert>>({});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarFeedback, setAvatarFeedback] = useState<string | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (businessQuery.data) setBusinessDraft(businessQuery.data);
  }, [businessQuery.data]);

  useEffect(() => {
    if (!selectedExpertId && expertsQuery.data?.[0]) setSelectedExpertId(expertsQuery.data[0].id);
  }, [expertsQuery.data, selectedExpertId]);

  const selectedExpert = expertsQuery.data?.find((expert) => expert.id === selectedExpertId);

  useEffect(() => {
    if (selectedExpert) {
      setExpertDraft(selectedExpert);
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setAvatarFeedback(null);
    }
  }, [selectedExpert]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  const submitBusinessMutation = useMutation({
    mutationFn: () => submitProfileChangeRequest(
      "business",
      selectedExpertId,
      {
        name: businessDraft.name ?? "",
        partnerType: businessDraft.partnerType ?? "freelancer",
        ownerName: businessDraft.ownerName ?? "",
        businessRegistrationNumber: businessDraft.businessRegistrationNumber ?? "",
        phone: businessDraft.phone ?? "",
        address: businessDraft.address ?? "",
        description: businessDraft.description ?? "",
        exposureStatus: businessDraft.exposureStatus ?? "public",
      },
      null,
      user ?? undefined,
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] }),
  });

  const submitExpertMutation = useMutation({
    mutationFn: () => submitProfileChangeRequest(
      "expert",
      selectedExpertId,
      {
        name: expertDraft.name ?? "",
        roleLabel: expertDraft.roleLabel ?? "",
        tagline: expertDraft.tagline ?? "",
        price30Min: expertDraft.price30Min ?? 0,
        price60Min: expertDraft.price60Min ?? 0,
        yearsOfExperience: expertDraft.yearsOfExperience ?? 0,
        exposureStatus: expertDraft.exposureStatus ?? "public",
        specialties: expertDraft.specialties ?? [],
        categories: expertDraft.categories ?? [],
        introduction: expertDraft.introduction ?? "",
      },
      avatarFile,
      user ?? undefined,
    ),
    onSuccess: async () => {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setAvatarFeedback("변경 심사 요청이 접수되었습니다.");
      await queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
    },
    onError: (error) => {
      setAvatarFeedback(error instanceof Error ? error.message : "변경 심사를 요청하지 못했습니다.");
    },
  });

  if (businessQuery.isLoading || expertsQuery.isLoading || requestsQuery.isLoading) {
    return <LoadingState label="업체와 전문가 정보를 불러오는 중입니다" />;
  }
  if (businessQuery.isError) return <ErrorState message={businessQuery.error.message} onRetry={() => businessQuery.refetch()} />;
  if (expertsQuery.isError) return <ErrorState message={expertsQuery.error.message} onRetry={() => expertsQuery.refetch()} />;
  if (requestsQuery.isError) return <ErrorState message={requestsQuery.error.message} onRetry={() => requestsQuery.refetch()} />;

  const businessRequest = latestRequest(requestsQuery.data, selectedExpertId, "business");
  const expertRequest = latestRequest(requestsQuery.data, selectedExpertId, "expert");

  return (
    <>
      <PageHeader
        title="업체 및 전문가 프로필"
        description="고객에게 공개되는 정보는 변경 심사 승인 후 반영됩니다. 심사 중에는 기존 프로필이 그대로 유지됩니다."
      />

      <div className="profile-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>업체 정보</h2>
              <p>수정 내용을 제출하면 운영팀 검토 후 공개 정보에 반영됩니다.</p>
            </div>
            <div className="tag-list">
              {businessQuery.data ? <BusinessVerificationBadge status={businessQuery.data.verificationStatus} /> : null}
              {businessQuery.data ? <ExposureStatusBadge status={businessQuery.data.exposureStatus} /> : null}
            </div>
          </div>
          <div className="panel-body settings-section">
            <ProfileRequestNotice request={businessRequest} />
            {businessQuery.data?.photos[0] ? <img className="profile-cover" src={businessQuery.data.photos[0].url} alt="" /> : null}
            <Field label="업체명"><TextInput value={businessDraft.name ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, name: event.target.value }))} /></Field>
            <Field label="운영 형태">
              <SelectInput value={businessDraft.partnerType ?? "business"} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, partnerType: event.target.value as PartnerType }))}>
                <option value="business">사업자 업체</option>
                <option value="freelancer">프리랜서 전문가</option>
              </SelectInput>
            </Field>
            <Field label="대표자"><TextInput value={businessDraft.ownerName ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, ownerName: event.target.value }))} /></Field>
            <Field label="사업자등록번호/인증번호"><TextInput value={businessDraft.businessRegistrationNumber ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, businessRegistrationNumber: event.target.value }))} /></Field>
            <Field label="전화번호"><TextInput value={businessDraft.phone ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, phone: event.target.value }))} /></Field>
            <Field label="주소"><TextInput value={businessDraft.address ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, address: event.target.value }))} /></Field>
            <Field label="소개 문구"><TextArea value={businessDraft.description ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, description: event.target.value }))} /></Field>
            <Field label="노출 상태">
              <SelectInput value={businessDraft.exposureStatus ?? "public"} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, exposureStatus: event.target.value as ExposureStatus }))}>
                <option value="public">공개</option><option value="private">비공개</option>
              </SelectInput>
            </Field>
            {submitBusinessMutation.isError ? <p className="form-error">{submitBusinessMutation.error.message}</p> : null}
            <Button variant="primary" icon={<Send size={16} />} disabled={submitBusinessMutation.isPending || !selectedExpertId} onClick={() => submitBusinessMutation.mutate()}>
              {submitBusinessMutation.isPending ? "심사 요청 중" : "업체 정보 변경 심사 요청"}
            </Button>

            <section className="profile-subsection">
              <div className="profile-subsection-header">
                <div><h3>제출 서류</h3><p>입점 신청 때 제출한 사업자 및 자격 확인 서류입니다.</p></div>
                {businessQuery.data ? <BusinessVerificationBadge status={businessQuery.data.verificationStatus} /> : null}
              </div>
              <div className="attachment-list">
                {businessQuery.data?.verificationDocuments.length ? businessQuery.data.verificationDocuments.map((document) => (
                  <div className="attachment-item" key={document.id}><strong>{document.name}</strong><p>{formatDate(document.uploadedAt)} 제출</p></div>
                )) : <p className="muted">제출된 서류가 없습니다.</p>}
              </div>
            </section>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div><h2>전문가 프로필</h2><p>사진을 포함한 변경 내용은 승인된 뒤 고객 화면에 반영됩니다.</p></div>
            <SelectInput className="narrow" value={selectedExpertId} onChange={(event) => setSelectedExpertId(event.target.value)}>
              {expertsQuery.data?.map((expert) => <option value={expert.id} key={expert.id}>{expert.name}</option>)}
            </SelectInput>
          </div>
          <div className="panel-body settings-section">
            <ProfileRequestNotice request={expertRequest} />
            {selectedExpert ? (
              <>
                <div className="expert-card">
                  <div className="profile-photo-editor">
                    <img className="profile-photo large" src={avatarPreviewUrl || expertDraft.avatarUrl || selectedExpert.avatarUrl} alt={`${selectedExpert.name} 프로필`} />
                    <input
                      ref={avatarInputRef}
                      className="profile-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (file.size > 10 * 1024 * 1024) {
                          setAvatarFeedback("10MB 이하의 사진을 선택해 주세요.");
                          return;
                        }
                        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
                        setAvatarFile(file);
                        setAvatarPreviewUrl(URL.createObjectURL(file));
                        setAvatarFeedback("선택한 사진은 변경 심사 요청을 제출할 때 업로드됩니다.");
                      }}
                    />
                    <Button type="button" variant="secondary" icon={<ImagePlus size={15} />} onClick={() => avatarInputRef.current?.click()}>사진 선택</Button>
                    <small>JPG, PNG, WebP · 최대 10MB</small>
                  </div>
                  <div className="cell-main">
                    <strong>{selectedExpert.name}</strong><span>{selectedExpert.roleLabel}</span><span>{selectedExpert.tagline}</span>
                    <span>{selectedExpert.rating}점 · 리뷰 {selectedExpert.reviewCount}개 · 상담 {selectedExpert.consultationCount.toLocaleString()}회 · 재예약률 {selectedExpert.rebookingRate}%</span>
                    <div className="tag-list"><ExposureStatusBadge status={selectedExpert.exposureStatus} /><span className="tag">30분 {formatCurrency(selectedExpert.price30Min)}</span><span className="tag">1시간 {formatCurrency(selectedExpert.price60Min)}</span></div>
                  </div>
                </div>
                {avatarFeedback ? <p className={`profile-upload-feedback ${submitExpertMutation.isError ? "is-error" : ""}`} role="status">{avatarFeedback}</p> : null}
                <div className="form-grid">
                  <Field label="이름"><TextInput value={expertDraft.name ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, name: event.target.value }))} /></Field>
                  <Field label="직함"><TextInput value={expertDraft.roleLabel ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, roleLabel: event.target.value }))} /></Field>
                  <div className="span-2"><Field label="프로필 한 줄 소개"><TextInput value={expertDraft.tagline ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, tagline: event.target.value }))} /></Field></div>
                  <Field label="30분 가격"><TextInput type="number" min={0} value={expertDraft.price30Min ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, price30Min: Number(event.target.value) }))} /></Field>
                  <Field label="1시간 가격"><TextInput type="number" min={0} value={expertDraft.price60Min ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, price60Min: Number(event.target.value) }))} /></Field>
                  <Field label="경력"><TextInput type="number" min={0} value={expertDraft.yearsOfExperience ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, yearsOfExperience: Number(event.target.value) }))} /></Field>
                  <Field label="노출 상태"><SelectInput value={expertDraft.exposureStatus ?? "public"} onChange={(event) => setExpertDraft((prev) => ({ ...prev, exposureStatus: event.target.value as ExposureStatus }))}><option value="public">공개</option><option value="private">비공개</option></SelectInput></Field>
                  <div className="span-2"><Field label="전문 분야"><TextInput value={(expertDraft.specialties ?? []).join(", ")} onChange={(event) => setExpertDraft((prev) => ({ ...prev, specialties: splitCsv(event.target.value) }))} /></Field></div>
                  <div className="span-2"><Field label="상담 가능 카테고리"><TextInput value={(expertDraft.categories ?? []).join(", ")} onChange={(event) => setExpertDraft((prev) => ({ ...prev, categories: splitCsv(event.target.value) }))} /></Field></div>
                  <div className="span-2"><Field label="소개 문구"><TextArea value={expertDraft.introduction ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, introduction: event.target.value }))} /></Field></div>
                </div>
                <Button variant="primary" icon={<Send size={16} />} disabled={submitExpertMutation.isPending} onClick={() => submitExpertMutation.mutate()}>
                  {submitExpertMutation.isPending ? "사진 업로드 및 심사 요청 중" : "전문가 프로필 변경 심사 요청"}
                </Button>
                <section className="profile-subsection">
                  <div className="profile-subsection-header"><div><h3>자격증 및 수료증</h3><p>등록된 전문 자격과 수료 내역입니다.</p></div></div>
                  <div className="attachment-list">
                    {selectedExpert.credentials.length ? selectedExpert.credentials.map((credential) => (
                      <div className="attachment-item" key={credential.id}><strong>{credential.name}</strong><p>{formatDate(credential.uploadedAt)} 등록</p></div>
                    )) : <p className="muted">등록된 자격증이나 수료증이 없습니다.</p>}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function latestRequest(requests: ProfileChangeRequest[] | undefined, expertId: string, targetType: ProfileChangeTarget) {
  return requests?.find((request) => request.expertId === expertId && request.targetType === targetType);
}

function ProfileRequestNotice({ request }: { request?: ProfileChangeRequest }) {
  if (!request) return null;
  return (
    <div className={`profile-review-notice is-${request.status}`}>
      <div><strong>최근 변경 심사</strong><span>{formatDateTime(request.updatedAt)} 제출</span></div>
      <ProfileChangeStatusBadge status={request.status} />
      {request.reviewMemo ? <p>운영팀 안내: {request.reviewMemo}</p> : null}
      {request.status === "submitted" ? <p>승인 전까지 고객 화면에는 기존 정보가 유지됩니다.</p> : null}
    </div>
  );
}

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
