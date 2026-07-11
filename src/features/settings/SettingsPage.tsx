import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, CheckCircle2, Clock3, Plug, Save, X } from "lucide-react";
import { getBusinessProfile, getSettings, updateBusinessProfile, updateSettings } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { ErrorState, LoadingState } from "../../shared/ui/StateViews";
import type { ManagerSettings, OperatingHours, TemporaryBookingBlock } from "../../types/domain";

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
  const [temporaryBlockDraft, setTemporaryBlockDraft] = useState({ date: toDateInputValue(new Date()), startsAt: "10:00", endsAt: "11:00", reason: "개인 일정" });
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

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
    onSuccess: (settings) => {
      setSettingsDraft(settings);
      setSettingsFeedback("저장되었습니다. 예약 캘린더에 바로 반영됩니다.");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error) => setSettingsFeedback(error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요."),
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
  const temporaryBlocks = settingsDraft.temporaryBookingBlocks ?? [];
  const saveSettings = () => {
    setSettingsFeedback(null);
    settingsMutation.mutate();
  };
  const addTemporaryBlock = () => {
    if (!temporaryBlockDraft.date || !temporaryBlockDraft.startsAt || !temporaryBlockDraft.endsAt) {
      setSettingsFeedback("차단할 날짜와 시작·종료 시간을 모두 입력해 주세요.");
      return;
    }
    if (temporaryBlockDraft.startsAt >= temporaryBlockDraft.endsAt) {
      setSettingsFeedback("종료 시간은 시작 시간 이후여야 합니다.");
      return;
    }
    const block: TemporaryBookingBlock = { id: `temporary-block-${Date.now()}`, ...temporaryBlockDraft };
    if (temporaryBlocks.some((item) => item.date === block.date && item.startsAt === block.startsAt && item.endsAt === block.endsAt)) {
      setSettingsFeedback("같은 날짜와 시간의 차단 일정이 이미 있습니다.");
      return;
    }
    setSettingsDraft((prev) => ({ ...prev, temporaryBookingBlocks: [...(prev.temporaryBookingBlocks ?? []), block] }));
    setSettingsFeedback("일회성 차단 일정을 추가했습니다. 아래 저장 버튼을 눌러 적용해 주세요.");
  };

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
              <p>매주 반복되는 기본 가능 시간입니다. 특정 날짜만 막으려면 오른쪽의 일회성 예약 차단을 사용하세요.</p>
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
            <SaveSettingsButton isPending={settingsMutation.isPending} label="영업시간 저장" onClick={saveSettings} />
            <SettingsFeedback isError={settingsMutation.isError} message={settingsFeedback} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>일회성 예약 차단</h2>
              <p>이번 주처럼 특정 날짜·시간에만 예약을 막습니다. 영업시간에는 영향을 주지 않고 반복되지 않습니다.</p>
            </div>
            <CalendarOff size={18} />
          </div>
          <div className="panel-body settings-section">
            <div className="temporary-block-form">
              <Field label="날짜">
                <TextInput type="date" value={temporaryBlockDraft.date} onChange={(event) => setTemporaryBlockDraft((prev) => ({ ...prev, date: event.target.value }))} />
              </Field>
              <Field label="시작">
                <TextInput type="time" value={temporaryBlockDraft.startsAt} onChange={(event) => setTemporaryBlockDraft((prev) => ({ ...prev, startsAt: event.target.value }))} />
              </Field>
              <Field label="종료">
                <TextInput type="time" value={temporaryBlockDraft.endsAt} onChange={(event) => setTemporaryBlockDraft((prev) => ({ ...prev, endsAt: event.target.value }))} />
              </Field>
              <Field label="사유 (선택)">
                <TextInput maxLength={60} placeholder="예: 외부 일정" value={temporaryBlockDraft.reason} onChange={(event) => setTemporaryBlockDraft((prev) => ({ ...prev, reason: event.target.value }))} />
              </Field>
            </div>
            <Button icon={<Clock3 size={16} />} variant="secondary" onClick={addTemporaryBlock}>
              차단 시간 추가
            </Button>
            {temporaryBlocks.length ? (
              <div aria-label="저장할 일회성 예약 차단 시간" className="temporary-block-list">
                {temporaryBlocks.slice().sort((a, b) => `${a.date}${a.startsAt}`.localeCompare(`${b.date}${b.startsAt}`)).map((block) => (
                  <div className="temporary-block-item" key={block.id}>
                    <div>
                      <strong>{formatBlockDate(block.date)} · {block.startsAt}–{block.endsAt}</strong>
                      <span>{block.reason || "예약 불가"}</span>
                    </div>
                    <Button
                      aria-label={`${block.date} ${block.startsAt} 예약 차단 삭제`}
                      icon={<X size={15} />}
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSettingsDraft((prev) => ({ ...prev, temporaryBookingBlocks: (prev.temporaryBookingBlocks ?? []).filter((item) => item.id !== block.id) }));
                        setSettingsFeedback("차단 일정을 제거했습니다. 아래 저장 버튼을 눌러 적용해 주세요.");
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                ))}
              </div>
            ) : <div className="temporary-block-empty">등록된 일회성 차단 시간이 없습니다.</div>}
            <SaveSettingsButton isPending={settingsMutation.isPending} label="일회성 차단 저장" onClick={saveSettings} />
            <SettingsFeedback isError={settingsMutation.isError} message={settingsFeedback} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>휴무일 설정</h2>
          </div>
          <div className="panel-body settings-section">
            <div className="form-grid">
              <Field label="하루 전체 휴무일 추가">
                <TextInput type="date" value={holidayDraft} onChange={(event) => setHolidayDraft(event.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => {
                if (!holidayDraft) return;
                setSettingsDraft((prev) => ({ ...prev, holidays: Array.from(new Set([...(prev.holidays ?? []), holidayDraft])) }));
                setHolidayDraft("");
                setSettingsFeedback("휴무일을 추가했습니다. 아래 저장 버튼을 눌러 적용해 주세요.");
              }}>
                추가
              </Button>
            </div>
            <div className="tag-list">
              {(settingsDraft.holidays ?? []).map((date) => <span className="tag" key={date}>{date}</span>)}
            </div>
            <SaveSettingsButton isPending={settingsMutation.isPending} label="휴무일 저장" onClick={saveSettings} />
            <SettingsFeedback isError={settingsMutation.isError} message={settingsFeedback} />
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
            <SaveSettingsButton isPending={settingsMutation.isPending} label="알림 저장" onClick={saveSettings} />
            <SettingsFeedback isError={settingsMutation.isError} message={settingsFeedback} />
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
                <SaveSettingsButton isPending={settingsMutation.isPending} label="연동 설정 저장" onClick={saveSettings} />
                <SettingsFeedback isError={settingsMutation.isError} message={settingsFeedback} />
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
    <section className={`operating-hour-card day-${hour.dayOfWeek} ${hour.isClosed ? "is-closed" : ""}`}>
      <header className="operating-hour-card-header">
        <div>
          <strong>{hour.label}요일</strong>
          <span>{hour.isClosed ? "매주 휴무" : "매주 예약 가능"}</span>
        </div>
        <Field label="운영 여부">
          <SelectInput value={hour.isClosed ? "closed" : "open"} onChange={(event) => onChange({ ...hour, isClosed: event.target.value === "closed" })}>
            <option value="open">영업</option>
            <option value="closed">휴무</option>
          </SelectInput>
        </Field>
      </header>
      <div className="operating-hour-time-grid">
        <Field label="예약 시작">
          <TextInput type="time" value={hour.opensAt} onChange={(event) => onChange({ ...hour, opensAt: event.target.value })} disabled={hour.isClosed} />
        </Field>
        <Field label="예약 마감">
          <TextInput type="time" value={hour.closesAt} onChange={(event) => onChange({ ...hour, closesAt: event.target.value })} disabled={hour.isClosed} />
        </Field>
        <Field label="점심 시작">
          <TextInput type="time" value={hour.lunchStart ?? ""} onChange={(event) => onChange({ ...hour, lunchStart: event.target.value })} disabled={hour.isClosed} />
        </Field>
        <Field label="점심 종료">
          <TextInput type="time" value={hour.lunchEnd ?? ""} onChange={(event) => onChange({ ...hour, lunchEnd: event.target.value })} disabled={hour.isClosed} />
        </Field>
      </div>
    </section>
  );
}

function SaveSettingsButton({ isPending, label, onClick }: { isPending: boolean; label: string; onClick: () => void }) {
  return (
    <Button disabled={isPending} icon={isPending ? <Clock3 size={16} /> : <Save size={16} />} onClick={onClick} variant="primary">
      {isPending ? "저장 중…" : label}
    </Button>
  );
}

function SettingsFeedback({ isError, message }: { isError: boolean; message: string | null }) {
  if (!message) return null;
  return (
    <div className={`settings-save-feedback ${isError ? "is-error" : ""}`} role="status">
      {isError ? <X size={16} /> : <CheckCircle2 size={16} />}
      <span>{message}</span>
    </div>
  );
}

function toDateInputValue(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function formatBlockDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(parsed);
}
