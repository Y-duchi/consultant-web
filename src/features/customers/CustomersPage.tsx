import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, Phone, Search } from "lucide-react";
import { createPhoneAction, getCustomerDetail, getCustomers, getExpertName } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { SelectInput, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatCurrency, formatDate, formatDateTime, toInputDate } from "../../shared/utils/format";
import type { Customer } from "../../types/domain";

export function CustomersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<"lastActiveDesc" | "nameAsc" | "paidDesc">("lastActiveDesc");
  const [activeAfter, setActiveAfter] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ["customers", query, tag, sort, user?.id, user?.workspaceScope],
    queryFn: () => getCustomers({ query, tag, sort }, user ?? undefined),
  });
  const detailQuery = useQuery({
    queryKey: ["customer-detail", selectedCustomerId],
    queryFn: () => getCustomerDetail(selectedCustomerId!),
    enabled: Boolean(selectedCustomerId),
  });

  const customers = useMemo(() => {
    const source = customersQuery.data ?? [];
    if (!activeAfter) return source;
    return source.filter((customer) => toInputDate(customer.lastActiveAt) >= activeAfter);
  }, [activeAfter, customersQuery.data]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    customersQuery.data?.forEach((customer) => customer.tags.forEach((item) => tags.add(item)));
    return Array.from(tags).sort();
  }, [customersQuery.data]);

  if (customersQuery.isLoading) return <LoadingState label="고객 목록을 불러오는 중입니다" />;
  if (customersQuery.isError) return <ErrorState message={customersQuery.error.message} onRetry={() => customersQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="고객 리포트 관리"
        description="고객이 앱에서 선택한 AI 뷰티 리포트, 예약 이력, 처방 노트, 내부 메모와 자료 첨부 이력을 드로어에서 확인합니다."
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 전화번호, 리포트 태그, 뷰티 고민 검색" />
        <SelectInput value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="all">전체 태그</option>
          {allTags.map((item) => (
            <option value={item} key={item}>{item}</option>
          ))}
        </SelectInput>
        <TextInput type="date" value={activeAfter} onChange={(event) => setActiveAfter(event.target.value)} title="최근 활동일 필터" />
        <SelectInput value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="lastActiveDesc">최근 활동순</option>
          <option value="nameAsc">이름순</option>
          <option value="paidDesc">결제금액순</option>
        </SelectInput>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>고객</th>
              <th>태그</th>
              <th>상담 이력</th>
              <th>총 결제</th>
              <th>최근 활동</th>
              <th>선호 채널</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} onOpen={() => setSelectedCustomerId(customer.id)} />
            ))}
          </tbody>
        </table>
        {customers.length === 0 ? <EmptyState title="조건에 맞는 고객이 없습니다" description="검색어나 필터를 조정해보세요." /> : null}
      </div>

      <Drawer
        open={Boolean(selectedCustomerId)}
        title={detailQuery.data?.customer.name ?? "고객 상세"}
        description={detailQuery.data ? `${detailQuery.data.customer.phone} · ${detailQuery.data.customer.email}` : undefined}
        onClose={() => setSelectedCustomerId(null)}
        footer={
          detailQuery.data ? (
            <>
              <Button variant="secondary" icon={<Phone size={16} />} onClick={() => createPhoneAction({ customerId: detailQuery.data.customer.id, channel: "phone" })}>
                전화 준비
              </Button>
              <Button variant="primary" icon={<MessageSquareText size={16} />} onClick={() => navigate("/chat")}>
                채팅 바로가기
              </Button>
            </>
          ) : null
        }
      >
        {detailQuery.isLoading ? <LoadingState label="고객 상세를 불러오는 중입니다" /> : null}
        {detailQuery.data ? (
          <div className="settings-section">
            <section className="panel">
              <div className="panel-header">
                <h3>기본 정보</h3>
              </div>
              <div className="panel-body">
                <div className="person-cell">
                  <img className="profile-photo large" src={detailQuery.data.customer.profileImageUrl} alt="" />
                  <div className="cell-main">
                    <strong>{detailQuery.data.customer.name}</strong>
                    <span>{detailQuery.data.customer.memo}</span>
                    <div className="tag-list">
                      {detailQuery.data.customer.tags.map((item) => <span className="tag" key={item}>{item}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>앱 예약 이력</h3>
              </div>
              <div className="panel-body report-list">
                {detailQuery.data.bookings.map((booking) => (
                  <div className="report-item" key={booking.id}>
                    <div className="thread-meta">
                      <strong>{booking.type}</strong>
                      <BookingStatusBadge status={booking.status} />
                    </div>
                    <p>{formatDateTime(booking.startsAt)} · {getExpertName(booking.expertId)} · {formatCurrency(booking.paidAmount)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>앱 선택 리포트와 처방 노트</h3>
              </div>
              <div className="panel-body report-list">
                {detailQuery.data.sharedReports.map((report) => (
                  <div className="report-item" key={report.id}>
                    <strong>{report.title}</strong>
                    <p>{report.summary}</p>
                    <span className="tag">{report.source === "customer_app" ? "고객 앱 선택" : "전문가 결과"}</span>
                  </div>
                ))}
                {detailQuery.data.consultationSummaries.map((summary) => (
                  <div className="summary-item" key={summary.id}>
                    <strong>상담 결과 요약</strong>
                    <p>{summary.customerSummary}</p>
                    <p>{summary.recommendations}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>사진/자료 첨부 이력</h3>
              </div>
              <div className="panel-body attachment-list">
                {detailQuery.data.customer.attachments.length === 0 ? (
                  <EmptyState title="첨부 자료가 없습니다" />
                ) : (
                  detailQuery.data.customer.attachments.map((attachment) => (
                    <div className="attachment-item" key={attachment.id}>
                      <strong>{attachment.name}</strong>
                      <p>{formatDate(attachment.uploadedAt)} · {attachment.type}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function CustomerRow({ customer, onOpen }: { customer: Customer; onOpen: () => void }) {
  return (
    <tr>
      <td>
        <div className="person-cell">
          <img src={customer.profileImageUrl} alt="" />
          <div className="cell-main">
            <strong>{customer.name}</strong>
            <span>{customer.phone}</span>
          </div>
        </div>
      </td>
      <td>
        <div className="tag-list">
          {customer.tags.map((item) => <span className="tag" key={item}>{item}</span>)}
        </div>
      </td>
      <td>{customer.completedBookings}/{customer.totalBookings} 완료</td>
      <td>{formatCurrency(customer.totalPaidAmount)}</td>
      <td>{formatDateTime(customer.lastActiveAt)}</td>
      <td>{customer.preferredChannel}</td>
      <td>
        <div className="row-actions">
          <Button variant="secondary" onClick={onOpen}>상세</Button>
        </div>
      </td>
    </tr>
  );
}
