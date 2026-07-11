import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Save } from "lucide-react";
import { getBusinessProfile, getSettings, updateBusinessProfile, updateSettings } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import type { ManagerSettings, OperatingHours } from "../../types/domain";

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getSettings(user ?? undefined),
  });
  const businessQuery = useQuery({ queryKey: ["business-profile", user?.businessId], queryFn: () => getBusinessProfile(user ?? undefined) });
  const [settingsDraft, setSettingsDraft] = useState<Partial<ManagerSettings>>({});
  const [policyDraft, setPolicyDraft] = useState({ cancellationPolicy: "", refundPolicy: "" });
  const [holidayDraft, setHolidayDraft] = useState("");

  useEffect(() => {
    if (settingsQuery.data) setSettingsDraft(settingsQuery.data);
  }, [settingsQuery.data]);
  useEffect(() => {
    if (businessQuery.data) {
      setPolicyDraft({
        cancellationPolicy: businessQuery.data.cancellationPolicy,
        refundPolicy: businessQuery.data.refundPolicy,
      });
    }
  }, [businessQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: () => updateSettings(settingsDraft, user ?? undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const policyMutation = useMutation({
    mutationFn: () => updateBusinessProfile(policyDraft, user ?? undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["business-profile"] }),
  });

  if (settingsQuery.isLoading || businessQuery.isLoading) return <LoadingState label="설정을 불러오는 중입니다" />;
  if (settingsQuery.isError) return <ErrorState message={settingsQuery.error.message} onRetry={() => settingsQuery.refetch()} />;
  if (businessQuery.isError) return <ErrorState message={businessQuery.error.message} onRetry={() => businessQuery.refetch()} />;

  const operatingHours = settingsDraft.operatingHours ?? [];
  const notification = settingsDraft.notification;
  const integrations = settingsDraft.integrations;

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="운영 설정"
        description="상담 기본 영업시간, 휴무일, 정책 문구, 알림, 계정 권한과 향후 전화/SMS/채팅 연동 지점을 관리합니다."
      />

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>영업시간 기본 설정</h2>
              <p>예약 캘린더의 기본 가능 시간으로 사용됩니다.</p>
            </div>
          </div>
          <div className="panel-body settings-section">
            <Field label="예약 오픈 범위">
              <SelectInput
                value={String(settingsDraft.bookingOpenMonths ?? 1)}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, bookingOpenMonths: Number(event.target.value) }))}
              >
                <option value="1">1개월</option>
                <option value="2">2개월</option>
                <option value="3">3개월</option>
              </SelectInput>
            </Field>
            {operatingHours.map((hour) => (
              <OperatingHourRow
                hour={hour}
                key={hour.dayOfWeek}
                onChange={(next) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    operatingHours: operatingHours.map((item) => (item.dayOfWeek === next.dayOfWeek ? next : item)),
                  }))
                }
              />
            ))}
            <Button variant="primary" icon={<Save size={16} />} onClick={() => settingsMutation.mutate()}>
              영업시간 저장
            </Button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>휴무일 설정</h2>
          </div>
          <div className="panel-body settings-section">
            <div className="form-grid">
              <Field label="휴무일 추가">
                <TextInput type="date" value={holidayDraft} onChange={(event) => setHolidayDraft(event.target.value)} />
              </Field>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!holidayDraft) return;
                  const next = Array.from(new Set([...(settingsDraft.holidays ?? []), holidayDraft]));
                  setSettingsDraft((prev) => ({ ...prev, holidays: next }));
                  setHolidayDraft("");
                }}
              >
                추가
              </Button>
            </div>
            <div className="tag-list">
              {(settingsDraft.holidays ?? []).map((date) => <span className="tag" key={date}>{date}</span>)}
            </div>
            <Button variant="primary" icon={<Save size={16} />} onClick={() => settingsMutation.mutate()}>
              휴무일 저장
            </Button>
          </div>
        </section>
      </div>

      <div className="grid-2 section-gap">
        <section className="panel">
          <div className="panel-header">
            <h2>취소/환불 정책 문구</h2>
          </div>
          <div className="panel-body settings-section">
            <Field label="예약 취소 정책">
              <TextArea value={policyDraft.cancellationPolicy} onChange={(event) => setPolicyDraft((prev) => ({ ...prev, cancellationPolicy: event.target.value }))} />
            </Field>
            <Field label="환불 정책">
              <TextArea value={policyDraft.refundPolicy} onChange={(event) => setPolicyDraft((prev) => ({ ...prev, refundPolicy: event.target.value }))} />
            </Field>
            <Button variant="primary" icon={<Save size={16} />} onClick={() => policyMutation.mutate()}>
              정책 저장
            </Button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>알림 설정</h2>
          </div>
          <div className="panel-body">
            {notification ? (
              Object.entries(notification).map(([key, value]) => (
                <label className="switch-row" key={key}>
                  <span className="cell-main">
                    <strong>{notificationLabel[key as keyof typeof notification]}</strong>
                    <span>추후 이메일, 앱 푸시, SMS로 분기할 수 있습니다.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(event) =>
                      setSettingsDraft((prev) => ({
                        ...prev,
                        notification: { ...notification, [key]: event.target.checked },
                      }))
                    }
                  />
                </label>
              ))
            ) : null}
          </div>
          <div className="drawer-footer">
            <Button variant="primary" icon={<Save size={16} />} onClick={() => settingsMutation.mutate()}>
              알림 저장
            </Button>
          </div>
        </section>
      </div>

      <div className="grid-2 section-gap">
        <section className="panel">
          <div className="panel-header">
            <h2>계정/권한 관리</h2>
          </div>
          <div className="panel-body">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>역할</th>
                    <th>범위</th>
                  </tr>
                </thead>
                <tbody>
                  {(settingsDraft.accountRoles ?? []).map((account) => (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td>{account.email}</td>
                      <td><Badge tone="info">{account.role}</Badge></td>
                      <td>{account.scope}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>전화/SMS/채팅 연동</h2>
              <p>실제 키와 provider 연결은 백엔드 붙일 때 활성화합니다.</p>
            </div>
            <Plug size={18} />
          </div>
          <div className="panel-body settings-section">
            {integrations ? (
              <>
                <Field label="전화 Provider">
                  <SelectInput value={integrations.phoneProvider} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, integrations: { ...integrations, phoneProvider: event.target.value as typeof integrations.phoneProvider } }))}>
                    <option value="none">미연동</option>
                    <option value="twilio">Twilio</option>
                    <option value="pinpoint">AWS Pinpoint</option>
                    <option value="sens">Naver Cloud SENS</option>
                  </SelectInput>
                </Field>
                <Field label="SMS Provider">
                  <SelectInput value={integrations.smsProvider} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, integrations: { ...integrations, smsProvider: event.target.value as typeof integrations.smsProvider } }))}>
                    <option value="none">미연동</option>
                    <option value="twilio">Twilio</option>
                    <option value="pinpoint">AWS Pinpoint</option>
                    <option value="sens">Naver Cloud SENS</option>
                  </SelectInput>
                </Field>
                <Field label="채팅 Provider">
                  <SelectInput value={integrations.chatProvider} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, integrations: { ...integrations, chatProvider: event.target.value as typeof integrations.chatProvider } }))}>
                    <option value="local_test">로컬 테스트 서비스</option>
                    <option value="websocket">FastAPI WebSocket</option>
                    <option value="firebase">Firebase</option>
                    <option value="sendbird">Sendbird</option>
                    <option value="stream">Stream</option>
                  </SelectInput>
                </Field>
                <Button variant="primary" icon={<Save size={16} />} onClick={() => settingsMutation.mutate()}>
                  연동 설정 저장
                </Button>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

const notificationLabel = {
  bookingCreated: "새 예약 생성",
  bookingReminder: "상담 전 리마인드",
  unreadChatDigest: "읽지 않은 채팅 요약",
  reviewCreated: "신규 리뷰 작성",
};

function OperatingHourRow({ hour, onChange }: { hour: OperatingHours; onChange: (hour: OperatingHours) => void }) {
  return (
    <div className="form-grid">
      <Field label="요일">
        <TextInput value={hour.label} disabled />
      </Field>
      <Field label="운영 여부">
        <SelectInput value={hour.isClosed ? "closed" : "open"} onChange={(event) => onChange({ ...hour, isClosed: event.target.value === "closed" })}>
          <option value="open">영업</option>
          <option value="closed">휴무</option>
        </SelectInput>
      </Field>
      <Field label="오픈">
        <TextInput type="time" value={hour.opensAt} onChange={(event) => onChange({ ...hour, opensAt: event.target.value })} disabled={hour.isClosed} />
      </Field>
      <Field label="마감">
        <TextInput type="time" value={hour.closesAt} onChange={(event) => onChange({ ...hour, closesAt: event.target.value })} disabled={hour.isClosed} />
      </Field>
      <Field label="점심 시작">
        <TextInput type="time" value={hour.lunchStart ?? ""} onChange={(event) => onChange({ ...hour, lunchStart: event.target.value })} disabled={hour.isClosed} />
      </Field>
      <Field label="점심 종료">
        <TextInput type="time" value={hour.lunchEnd ?? ""} onChange={(event) => onChange({ ...hour, lunchEnd: event.target.value })} disabled={hour.isClosed} />
      </Field>
    </div>
  );
}
