import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { getConsultationSummaryJobs } from "../../services/api";
import { Badge } from "../../shared/ui/Badge";
import { SelectInput, TextInput } from "../../shared/ui/Field";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import { formatDateTime } from "../../shared/utils/format";
import type { ConsultationSummaryAiStatus } from "../../types/domain";

const statusOptions: Array<ConsultationSummaryAiStatus | "all"> = ["all", "queued", "processing", "succeeded", "failed"];

export function AdminSummaryJobsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ConsultationSummaryAiStatus | "all">("all");
  const jobsQuery = useQuery({
    queryKey: ["admin-summary-jobs"],
    queryFn: () => getConsultationSummaryJobs(),
  });

  if (jobsQuery.isLoading) return <LoadingState label="AI 요약 작업을 불러오는 중입니다" />;
  if (jobsQuery.isError) return <ErrorState message={jobsQuery.error.message} onRetry={() => jobsQuery.refetch()} />;

  const jobs = (jobsQuery.data ?? []).filter((job) => {
    const keyword = query.toLowerCase();
    const matchesQuery = [job.id, job.bookingId, job.businessId, job.expertId, job.errorMessage]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(keyword));
    return matchesQuery && (status === "all" || job.status === status);
  });

  return (
    <>
      <PageHeader
        eyebrow="AI Summary Jobs"
        title="AI 요약 작업 상태"
        description="전화상담 transcript와 상담 메모를 OpenAI 요약으로 저장하는 작업 상태를 운영자 scope에서 확인합니다."
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="작업 ID, 예약 ID, business_id 검색" />
        <SelectInput value={status} onChange={(event) => setStatus(event.target.value as ConsultationSummaryAiStatus | "all")}>
          {statusOptions.map((option) => (
            <option value={option} key={option}>{option === "all" ? "전체 상태" : option}</option>
          ))}
        </SelectInput>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>작업</th>
              <th>예약</th>
              <th>업체/전문가</th>
              <th>상태</th>
              <th>소스</th>
              <th>모델</th>
              <th>최근 변경</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <div className="cell-main">
                    <strong>{job.id}</strong>
                    {job.errorMessage ? <span>{job.errorMessage}</span> : null}
                  </div>
                </td>
                <td>{job.bookingId}</td>
                <td>{job.businessId} · {job.expertId}</td>
                <td><Badge tone={job.status === "succeeded" ? "success" : job.status === "failed" ? "danger" : "warning"}>{job.status}</Badge></td>
                <td>{job.source}</td>
                <td>{job.aiModel ?? "env"}</td>
                <td>{formatDateTime(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 ? <EmptyState title="조건에 맞는 AI 요약 작업이 없습니다" /> : null}
      </div>
    </>
  );
}
