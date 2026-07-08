import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getAdminBusinesses, getAdminExperts } from "../../services/api";
import { BusinessVerificationBadge, ExposureStatusBadge } from "../../shared/ui/Badge";
import { TextInput } from "../../shared/ui/Field";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import { formatCurrency } from "../../shared/utils/format";

export function AdminPartnersPage() {
  const [query, setQuery] = useState("");
  const businessesQuery = useQuery({ queryKey: ["admin-businesses"], queryFn: getAdminBusinesses });
  const expertsQuery = useQuery({ queryKey: ["admin-experts"], queryFn: getAdminExperts });

  const businesses = useMemo(() => {
    const keyword = query.toLowerCase();
    return (businessesQuery.data ?? []).filter((business) =>
      [business.name, business.ownerName, business.phone, business.businessRegistrationNumber]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(keyword)),
    );
  }, [businessesQuery.data, query]);

  const experts = useMemo(() => {
    const keyword = query.toLowerCase();
    return (expertsQuery.data ?? []).filter((expert) =>
      [expert.name, expert.email, expert.phone, expert.specialties.join(" "), expert.categories.join(" ")]
        .some((value) => value.toLowerCase().includes(keyword)),
    );
  }, [expertsQuery.data, query]);

  if (businessesQuery.isLoading || expertsQuery.isLoading) return <LoadingState label="업체와 전문가 목록을 불러오는 중입니다" />;
  if (businessesQuery.isError) return <ErrorState message={businessesQuery.error.message} onRetry={() => businessesQuery.refetch()} />;
  if (expertsQuery.isError) return <ErrorState message={expertsQuery.error.message} onRetry={() => expertsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Businesses"
        title="업체와 전문가 목록"
        description="승인된 업체, 소속 전문가, 노출 상태와 인증 상태를 플랫폼 기준으로 확인합니다."
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체명, 대표자, 전문가명, 전문 분야 검색" />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>업체</h2>
            <p>business_id 기준으로 partner workspace scope가 결정됩니다.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>업체</th>
                <th>대표자</th>
                <th>인증</th>
                <th>노출</th>
                <th>연락처</th>
                <th>business_id</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.id}>
                  <td>
                    <div className="cell-main">
                      <strong>{business.name}</strong>
                      <span>{business.partnerType === "business" ? "사업자 업체" : "프리랜서"}</span>
                    </div>
                  </td>
                  <td>{business.ownerName}</td>
                  <td><BusinessVerificationBadge status={business.verificationStatus} /></td>
                  <td><ExposureStatusBadge status={business.exposureStatus} /></td>
                  <td>{business.phone}</td>
                  <td>{business.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {businesses.length === 0 ? <EmptyState title="조건에 맞는 업체가 없습니다" /> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>전문가</h2>
            <p>전문가 개인 계정은 expert_id까지 scope를 좁혀 예약과 고객을 조회합니다.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>전문가</th>
                <th>업체</th>
                <th>전문 분야</th>
                <th>가격</th>
                <th>노출</th>
                <th>상담 수</th>
              </tr>
            </thead>
            <tbody>
              {experts.map((expert) => (
                <tr key={expert.id}>
                  <td>
                    <div className="person-cell">
                      <img src={expert.avatarUrl} alt="" />
                      <div className="cell-main">
                        <strong>{expert.name}</strong>
                        <span>{expert.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{expert.businessId}</td>
                  <td>{expert.specialties.slice(0, 3).join(", ")}</td>
                  <td>{formatCurrency(expert.price30Min)} / {formatCurrency(expert.price60Min)}</td>
                  <td><ExposureStatusBadge status={expert.exposureStatus} /></td>
                  <td>{expert.consultationCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {experts.length === 0 ? <EmptyState title="조건에 맞는 전문가가 없습니다" /> : null}
        </div>
      </section>
    </>
  );
}
