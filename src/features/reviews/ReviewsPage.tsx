import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageSquareReply, Search, Star, StarOff } from "lucide-react";
import { getBookingDetail, getCustomerName, getExpertName, getReviews, updateReview } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { ReviewStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime, toInputDate } from "../../shared/utils/format";
import { reviewStatusOptions } from "../../shared/utils/options";
import type { Review, ReviewStatus } from "../../types/domain";

export function ReviewsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [rating, setRating] = useState<number | "all">("all");
  const [createdAfter, setCreatedAfter] = useState("");
  const [sort, setSort] = useState<"createdDesc" | "ratingDesc" | "ratingAsc">("createdDesc");
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const reviewsQuery = useQuery({
    queryKey: ["reviews", query, status, rating, sort, user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getReviews({ query, status, rating, sort }, user ?? undefined),
  });
  const reviews = useMemo(() => {
    const source = reviewsQuery.data ?? [];
    if (!createdAfter) return source;
    return source.filter((review) => toInputDate(review.createdAt) >= createdAfter);
  }, [createdAfter, reviewsQuery.data]);
  const selectedReview = reviewsQuery.data?.find((review) => review.id === selectedReviewId);
  const detailQuery = useQuery({
    queryKey: ["review-booking-detail", selectedReview?.bookingId, user?.id, user?.businessId],
    queryFn: () => getBookingDetail(selectedReview!.bookingId, user ?? undefined),
    enabled: Boolean(selectedReview?.bookingId),
  });

  const updateMutation = useMutation({
    mutationFn: ({ reviewId, patch }: { reviewId: string; patch: Parameters<typeof updateReview>[1] }) => updateReview(reviewId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  if (reviewsQuery.isLoading) return <LoadingState label="리뷰를 불러오는 중입니다" />;
  if (reviewsQuery.isError) return <ErrorState message={reviewsQuery.error.message} onRetry={() => reviewsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Reviews"
        title="리뷰 관리"
        description="고객 앱의 전문가 상세 페이지에 노출되는 리뷰를 예약 건, 고객, 전문가와 연결해 확인합니다. 숨김/신고/답글은 현재 UI와 mock 상태 변경만 제공합니다."
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 전문가, 리뷰 내용 검색" />
        <SelectInput value={status} onChange={(event) => setStatus(event.target.value as ReviewStatus | "all")}>
          {reviewStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </SelectInput>
        <SelectInput value={rating} onChange={(event) => setRating(event.target.value === "all" ? "all" : Number(event.target.value))}>
          <option value="all">전체 별점</option>
          {[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value}점</option>)}
        </SelectInput>
        <TextInput type="date" value={createdAfter} onChange={(event) => setCreatedAfter(event.target.value)} />
        <SelectInput value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="createdDesc">최신순</option>
          <option value="ratingDesc">별점 높은순</option>
          <option value="ratingAsc">별점 낮은순</option>
        </SelectInput>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>별점</th>
              <th>리뷰</th>
              <th>고객</th>
              <th>전문가</th>
              <th>작성일</th>
              <th>상태</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <ReviewRow key={review.id} review={review} onOpen={() => {
                setSelectedReviewId(review.id);
                setReply(review.reply ?? "");
              }} />
            ))}
          </tbody>
        </table>
        {reviews.length === 0 ? <EmptyState title="조건에 맞는 리뷰가 없습니다" /> : null}
      </div>

      <Drawer
        open={Boolean(selectedReview)}
        title="리뷰 상세"
        description={selectedReview ? `${getCustomerName(selectedReview.customerId)} · ${formatDateTime(selectedReview.createdAt)}` : undefined}
        onClose={() => setSelectedReviewId(null)}
        footer={
          selectedReview ? (
            <>
              <Button variant="secondary" icon={<StarOff size={16} />} onClick={() => updateMutation.mutate({ reviewId: selectedReview.id, patch: { status: "hidden" } })}>
                숨김
              </Button>
              <Button variant="secondary" icon={<Flag size={16} />} onClick={() => updateMutation.mutate({ reviewId: selectedReview.id, patch: { status: "reported" } })}>
                신고
              </Button>
              <Button variant="primary" icon={<MessageSquareReply size={16} />} onClick={() => updateMutation.mutate({ reviewId: selectedReview.id, patch: { reply, status: "visible" } })}>
                답글 저장
              </Button>
            </>
          ) : null
        }
      >
        {selectedReview ? (
          <div className="settings-section">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>{getCustomerName(selectedReview.customerId)} 고객 리뷰</h3>
                  <p>완료된 앱 상담 예약과 연결된 리뷰입니다.</p>
                </div>
                <ReviewStatusBadge status={selectedReview.status} />
              </div>
              <div className="panel-body settings-section">
                <div className="tag-list">
                  {Array.from({ length: selectedReview.rating }, (_, index) => <Star key={index} size={16} fill="currentColor" />)}
                </div>
                <p>{selectedReview.content}</p>
                <FieldlessReply value={reply} onChange={setReply} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h3>연결 예약</h3>
              </div>
              <div className="panel-body">
                {detailQuery.isLoading ? <LoadingState label="예약 연결 정보를 불러오는 중입니다" /> : null}
                {detailQuery.data ? (
                  <dl className="detail-list">
                    <div className="detail-row">
                      <dt>예약</dt>
                      <dd>{detailQuery.data.booking.type}</dd>
                    </div>
                    <div className="detail-row">
                      <dt>일시</dt>
                      <dd>{formatDateTime(detailQuery.data.booking.startsAt)}</dd>
                    </div>
                    <div className="detail-row">
                      <dt>전문가</dt>
                      <dd>{detailQuery.data.expert.name}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function ReviewRow({ onOpen, review }: { review: Review; onOpen: () => void }) {
  return (
    <tr>
      <td>
        <div className="tag-list">
          <Star size={15} fill="currentColor" />
          <strong>{review.rating}</strong>
        </div>
      </td>
      <td>
        <div className="cell-main">
          <strong>{review.content}</strong>
          <span>예약 #{review.bookingId}</span>
        </div>
      </td>
      <td>{getCustomerName(review.customerId)}</td>
      <td>{getExpertName(review.expertId)}</td>
      <td>{formatDateTime(review.createdAt)}</td>
      <td><ReviewStatusBadge status={review.status} /></td>
      <td>
        <div className="row-actions">
          <Button variant="secondary" onClick={onOpen}>상세</Button>
        </div>
      </td>
    </tr>
  );
}

function FieldlessReply({ onChange, value }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>답글</span>
      <TextArea value={value} onChange={(event) => onChange(event.target.value)} placeholder="리뷰 답글을 작성하세요." />
    </label>
  );
}
