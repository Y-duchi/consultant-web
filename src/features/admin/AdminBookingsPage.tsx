import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getAdminBookings, getCustomerName, getExpertName } from "../../services/api";
import { BookingStatusBadge, PaymentStatusBadge } from "../../shared/ui/Badge";
import { SelectInput, TextInput } from "../../shared/ui/Field";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import { bookingStatusOptions } from "../../shared/utils/options";
import { formatCurrency, formatDateTime } from "../../shared/utils/format";
import type { BookingStatus } from "../../types/domain";

export function AdminBookingsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const bookingsQuery = useQuery({
    queryKey: ["admin-bookings", query, status],
    queryFn: () => getAdminBookings({ query, status, sort: "startsAtDesc" }),
  });

  if (bookingsQuery.isLoading) return <LoadingState label="전체 예약을 불러오는 중입니다" />;
  if (bookingsQuery.isError) return <ErrorState message={bookingsQuery.error.message} onRetry={() => bookingsQuery.refetch()} />;

  const bookings = bookingsQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="All Bookings"
        title="전체 예약 관리"
        description="운영자는 모든 업체의 예약, 결제, 환불 요청 상태를 전체 scope에서 확인합니다."
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 전문가명, 상담 유형 검색" />
        <SelectInput value={status} onChange={(event) => setStatus(event.target.value as BookingStatus | "all")}>
          {bookingStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </SelectInput>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>예약</th>
              <th>업체</th>
              <th>고객</th>
              <th>전문가</th>
              <th>상태</th>
              <th>결제</th>
              <th>일시</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td>
                  <div className="cell-main">
                    <strong>{booking.type}</strong>
                    <span>{booking.id}</span>
                  </div>
                </td>
                <td>{booking.businessId}</td>
                <td>{getCustomerName(booking.customerId)}</td>
                <td>{getExpertName(booking.expertId)}</td>
                <td><BookingStatusBadge status={booking.status} /></td>
                <td>
                  <div className="cell-main">
                    <PaymentStatusBadge status={booking.paymentStatus} />
                    <span>{formatCurrency(booking.paidAmount)}</span>
                  </div>
                </td>
                <td>{formatDateTime(booking.startsAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bookings.length === 0 ? <EmptyState title="조건에 맞는 예약이 없습니다" /> : null}
      </div>
    </>
  );
}
