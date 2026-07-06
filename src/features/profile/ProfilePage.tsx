import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Save, Upload } from "lucide-react";
import { getBusinessProfile, getExperts, updateBusinessProfile, updateExpertProfile, uploadBusinessVerificationMock, uploadCredentialMock } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BusinessVerificationBadge, ExposureStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatCurrency, formatDate } from "../../shared/utils/format";
import type { BusinessProfile, Expert, ExposureStatus, PartnerType } from "../../types/domain";

export function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const businessQuery = useQuery({ queryKey: ["business-profile"], queryFn: getBusinessProfile });
  const expertsQuery = useQuery({ queryKey: ["experts", user?.id, user?.workspaceScope], queryFn: () => getExperts(user ?? undefined) });
  const [businessDraft, setBusinessDraft] = useState<Partial<BusinessProfile>>({});
  const [selectedExpertId, setSelectedExpertId] = useState("");
  const [expertDraft, setExpertDraft] = useState<Partial<Expert>>({});
  const [credentialName, setCredentialName] = useState("퍼스널컬러 컨설턴트 자격증.jpg");
  const [businessVerificationFile, setBusinessVerificationFile] = useState("사업자등록증_AURA성수.pdf");

  useEffect(() => {
    if (businessQuery.data) setBusinessDraft(businessQuery.data);
  }, [businessQuery.data]);

  useEffect(() => {
    if (!selectedExpertId && expertsQuery.data?.[0]) {
      setSelectedExpertId(expertsQuery.data[0].id);
    }
  }, [expertsQuery.data, selectedExpertId]);

  const selectedExpert = expertsQuery.data?.find((expert) => expert.id === selectedExpertId);

  useEffect(() => {
    if (selectedExpert) setExpertDraft(selectedExpert);
  }, [selectedExpert]);

  const businessMutation = useMutation({
    mutationFn: () => updateBusinessProfile(businessDraft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["business-profile"] }),
  });
  const expertMutation = useMutation({
    mutationFn: () => updateExpertProfile(selectedExpertId, expertDraft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["experts"] }),
  });
  const uploadMutation = useMutation({
    mutationFn: () => uploadCredentialMock(selectedExpertId, credentialName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["experts"] }),
  });
  const businessVerificationMutation = useMutation({
    mutationFn: () => uploadBusinessVerificationMock(businessVerificationFile),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["business-profile"] }),
  });

  if (businessQuery.isLoading || expertsQuery.isLoading) return <LoadingState label="파트너와 전문가 정보를 불러오는 중입니다" />;
  if (businessQuery.isError) return <ErrorState message={businessQuery.error.message} onRetry={() => businessQuery.refetch()} />;
  if (expertsQuery.isError) return <ErrorState message={expertsQuery.error.message} onRetry={() => expertsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Profiles"
        title="파트너 등록, 인증 및 전문가 프로필"
        description="고객 앱에 노출될 업체/프리랜서 정보와 전문가 프로필, 사업자 인증, 상담 가격과 카테고리를 관리합니다."
      />

      <div className="profile-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>업체 정보</h2>
              <p>고객 앱 전문가 목록과 결제 화면에 노출될 파트너 정보입니다.</p>
            </div>
            <div className="tag-list">
              {businessQuery.data ? <BusinessVerificationBadge status={businessQuery.data.verificationStatus} /> : null}
              {businessQuery.data ? <ExposureStatusBadge status={businessQuery.data.exposureStatus} /> : null}
            </div>
          </div>
          <div className="panel-body settings-section">
            {businessQuery.data?.photos[0] ? (
              <img className="profile-cover" src={businessQuery.data.photos[0].url} alt="" />
            ) : null}
            <Field label="업체명">
              <TextInput value={businessDraft.name ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, name: event.target.value }))} />
            </Field>
            <Field label="파트너 유형">
              <SelectInput value={businessDraft.partnerType ?? "business"} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, partnerType: event.target.value as PartnerType }))}>
                <option value="business">사업자 업체</option>
                <option value="freelancer">프리랜서 전문가</option>
              </SelectInput>
            </Field>
            <Field label="대표자">
              <TextInput value={businessDraft.ownerName ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, ownerName: event.target.value }))} />
            </Field>
            <Field label="사업자등록번호/인증번호">
              <TextInput value={businessDraft.businessRegistrationNumber ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, businessRegistrationNumber: event.target.value }))} />
            </Field>
            <Field label="전화번호">
              <TextInput value={businessDraft.phone ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, phone: event.target.value }))} />
            </Field>
            <Field label="주소">
              <TextInput value={businessDraft.address ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, address: event.target.value }))} />
            </Field>
            <Field label="소개 문구">
              <TextArea value={businessDraft.description ?? ""} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, description: event.target.value }))} />
            </Field>
            <Field label="노출 상태">
              <SelectInput value={businessDraft.exposureStatus ?? "public"} onChange={(event) => setBusinessDraft((prev) => ({ ...prev, exposureStatus: event.target.value as ExposureStatus }))}>
                <option value="public">공개</option>
                <option value="private">비공개</option>
                <option value="pending_review">검수중</option>
              </SelectInput>
            </Field>
            <Button variant="primary" icon={<Save size={16} />} onClick={() => businessMutation.mutate()}>
              업체 정보 저장
            </Button>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>사업자/파트너 인증</h3>
                  <p>실제 업체 여부를 확인하기 위한 증빙 제출 영역입니다.</p>
                </div>
                {businessQuery.data ? <BusinessVerificationBadge status={businessQuery.data.verificationStatus} /> : null}
              </div>
              <div className="panel-body settings-section">
                <div className="form-grid">
                  <Field label="증빙 파일명">
                    <TextInput value={businessVerificationFile} onChange={(event) => setBusinessVerificationFile(event.target.value)} />
                  </Field>
                  <Button variant="secondary" icon={<Upload size={16} />} onClick={() => businessVerificationMutation.mutate()} disabled={!businessVerificationFile.trim()}>
                    인증 서류 Mock 제출
                  </Button>
                </div>
                <div className="attachment-list">
                  {businessQuery.data?.verificationDocuments.map((document) => (
                    <div className="attachment-item" key={document.id}>
                      <strong>{document.name}</strong>
                      <p>{formatDate(document.uploadedAt)} · 추후 사업자 OCR/S3 presigned URL 업로드로 교체</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>전문가 프로필</h2>
              <p>고객 앱의 전문가 선택, 상세 프로필, 가격 카드에 노출됩니다.</p>
            </div>
            <SelectInput className="narrow" value={selectedExpertId} onChange={(event) => setSelectedExpertId(event.target.value)}>
              {expertsQuery.data?.map((expert) => (
                <option value={expert.id} key={expert.id}>{expert.name}</option>
              ))}
            </SelectInput>
          </div>
          <div className="panel-body settings-section">
            {selectedExpert ? (
              <>
                <div className="expert-card">
                  <img className="profile-photo large" src={selectedExpert.avatarUrl} alt="" />
                  <div className="cell-main">
                    <strong>{selectedExpert.name}</strong>
                    <span>{selectedExpert.roleLabel}</span>
                    <span>{selectedExpert.tagline}</span>
                    <span>{selectedExpert.rating}점 · 리뷰 {selectedExpert.reviewCount}개 · 상담 {selectedExpert.consultationCount.toLocaleString()}회 · 재예약률 {selectedExpert.rebookingRate}%</span>
                    <div className="tag-list">
                      <ExposureStatusBadge status={selectedExpert.exposureStatus} />
                      <span className="tag">30분 {formatCurrency(selectedExpert.price30Min)}</span>
                      <span className="tag">1시간 {formatCurrency(selectedExpert.price60Min)}</span>
                    </div>
                  </div>
                </div>
                <div className="form-grid">
                  <Field label="이름">
                    <TextInput value={expertDraft.name ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, name: event.target.value }))} />
                  </Field>
                  <Field label="직함">
                    <TextInput value={expertDraft.roleLabel ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, roleLabel: event.target.value }))} />
                  </Field>
                  <div className="span-2">
                    <Field label="앱 프로필 한 줄 소개">
                      <TextInput value={expertDraft.tagline ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, tagline: event.target.value }))} />
                    </Field>
                  </div>
                  <Field label="30분 가격">
                    <TextInput type="number" value={expertDraft.price30Min ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, price30Min: Number(event.target.value) }))} />
                  </Field>
                  <Field label="1시간 가격">
                    <TextInput type="number" value={expertDraft.price60Min ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, price60Min: Number(event.target.value) }))} />
                  </Field>
                  <Field label="경력">
                    <TextInput type="number" value={expertDraft.yearsOfExperience ?? 0} onChange={(event) => setExpertDraft((prev) => ({ ...prev, yearsOfExperience: Number(event.target.value) }))} />
                  </Field>
                  <Field label="노출 상태">
                    <SelectInput value={expertDraft.exposureStatus ?? "public"} onChange={(event) => setExpertDraft((prev) => ({ ...prev, exposureStatus: event.target.value as ExposureStatus }))}>
                      <option value="public">공개</option>
                      <option value="private">비공개</option>
                      <option value="pending_review">검수중</option>
                    </SelectInput>
                  </Field>
                  <div className="span-2">
                    <Field label="전문 분야">
                      <TextInput value={(expertDraft.specialties ?? []).join(", ")} onChange={(event) => setExpertDraft((prev) => ({ ...prev, specialties: splitCsv(event.target.value) }))} />
                    </Field>
                  </div>
                  <div className="span-2">
                    <Field label="상담 가능 카테고리">
                      <TextInput value={(expertDraft.categories ?? []).join(", ")} onChange={(event) => setExpertDraft((prev) => ({ ...prev, categories: splitCsv(event.target.value) }))} />
                    </Field>
                  </div>
                  <div className="span-2">
                    <Field label="소개 문구">
                      <TextArea value={expertDraft.introduction ?? ""} onChange={(event) => setExpertDraft((prev) => ({ ...prev, introduction: event.target.value }))} />
                    </Field>
                  </div>
                </div>
                <Button variant="primary" icon={<Save size={16} />} onClick={() => expertMutation.mutate()}>
                  전문가 프로필 저장
                </Button>

                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h3>자격증/수료증 이미지</h3>
                      <p>현재는 mock 업로드이며 실제 파일은 전송하지 않습니다.</p>
                    </div>
                    <ImagePlus size={18} />
                  </div>
                  <div className="panel-body settings-section">
                    <div className="form-grid">
                      <Field label="업로드 파일명">
                        <TextInput value={credentialName} onChange={(event) => setCredentialName(event.target.value)} />
                      </Field>
                      <Button variant="secondary" icon={<Upload size={16} />} onClick={() => uploadMutation.mutate()} disabled={!credentialName.trim()}>
                        Mock 업로드
                      </Button>
                    </div>
                    <div className="attachment-list">
                      {selectedExpert.credentials.map((credential) => (
                        <div className="attachment-item" key={credential.id}>
                          <strong>{credential.name}</strong>
                          <p>{formatDate(credential.uploadedAt)} · S3 presigned URL 교체 예정</p>
                        </div>
                      ))}
                    </div>
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

function splitCsv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
