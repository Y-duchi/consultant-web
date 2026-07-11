import { useQuery } from "@tanstack/react-query";
import { FileText, Palette, Sparkles } from "lucide-react";
import { getSharedReportDetail } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "../../shared/ui/Badge";
import { formatDateTime } from "../../shared/utils/format";
import type { SharedReport } from "../../types/domain";

interface AppReportCardProps {
  className?: string;
  compact?: boolean;
  onClick?: () => void;
  report: SharedReport;
  selected?: boolean;
}

type ReportImage = {
  label: string;
  url: string;
};

const preferredMetrics: Array<[string, string]> = [
  ["personalColor", "퍼스널 컬러"],
  ["faceShape", "얼굴형"],
  ["skinType", "피부 타입"],
  ["toneSummary", "톤 요약"],
  ["recommendedMood", "추천 무드"],
  ["shootingQuality", "촬영 품질"],
  ["baseMakeupGuide", "베이스"],
  ["blushGuide", "블러셔"],
  ["lipGuide", "립"],
  ["browGuide", "브로우"],
];

export function AppReportCard({ className = "", compact = false, onClick, report, selected = false }: AppReportCardProps) {
  const { user } = useAuth();
  const detailQuery = useQuery({
    queryKey: ["app-report-detail", report.id, user?.id, user?.businessId],
    queryFn: () => getSharedReportDetail(report.id, user ?? undefined),
    enabled: true,
  });
  const detail = detailQuery.data?.detail ?? {};
  const palette = getPalette(detail.colorPalette);
  const keyFindings = getStringList(detail.keyFindings);
  const actionSteps = getStringList(detail.actionSteps);
  const images = getReportImages(detail);
  const metrics = preferredMetrics
    .map(([key, label]) => ({ label, value: readableReportValue(detail[key]) }))
    .filter((entry) => entry.value)
    .slice(0, compact ? 3 : 8);
  const Element = onClick ? "button" : "article";

  return (
    <Element
      className={[
        "app-report-card",
        compact ? "compact" : "",
        selected ? "is-active" : "",
        onClick ? "is-clickable" : "",
        className,
      ].filter(Boolean).join(" ")}
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      <div className="app-report-head">
        <span className="app-report-icon">
          {report.source === "customer_app" ? <Sparkles size={15} /> : <FileText size={15} />}
        </span>
        <div className="cell-main">
          <strong>{report.title}</strong>
          <span>{report.category} · {formatDateTime(report.createdAt)}</span>
        </div>
        <Badge tone={report.source === "customer_app" ? "info" : "success"}>
          {report.source === "customer_app" ? "앱 분석" : "전문가 작성"}
        </Badge>
      </div>

      {compact ? (
        <div className="app-report-compact-body">
          {images[0] ? <img className="app-report-thumbnail" alt={`${report.title} 대표 이미지`} src={images[0].url} /> : null}
          <div>
            <p className="app-report-summary">{report.summary}</p>
            <span className="app-report-open-label">클릭해서 사진과 상세 분석 보기</span>
          </div>
        </div>
      ) : null}

      {!compact ? (
        <>
          <div className="app-report-main">
            {images.length > 0 ? (
              <div className={`app-report-image-grid ${images.length === 1 ? "is-single" : ""}`}>
                {images.map((image) => (
                  <figure key={`${image.label}-${image.url}`}>
                    <img className="app-report-image" alt={`${report.title} ${image.label}`} src={image.url} />
                    <figcaption>{image.label}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
            <div className="app-report-narrative">
              <span className="app-report-kicker">AI 얼굴 리포트</span>
              <p>{getString(detail.shortSummary) || report.summary}</p>
              {detailQuery.isLoading ? <span className="muted">리포트 상세를 불러오는 중입니다</span> : null}
              {detailQuery.isError ? <span className="form-error">{detailQuery.error.message}</span> : null}
            </div>
          </div>

          {metrics.length > 0 ? (
            <dl className="app-report-metrics">
              {metrics.map((entry) => (
                <div key={entry.label}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {palette.length > 0 ? (
            <section className="app-report-section">
              <strong><Palette size={14} /> 추천 팔레트</strong>
              <div className="color-swatch-row">
                {palette.map((item) => (
                  <span className="color-swatch" key={`${item.name}-${item.hex}`}>
                    <i style={{ background: item.hex }} />
                    {item.name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {keyFindings.length > 0 ? (
            <section className="app-report-section">
              <strong>핵심 진단</strong>
              <ul className="clean-list">
                {keyFindings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ) : null}

          {actionSteps.length > 0 ? (
            <section className="app-report-section">
              <strong>상담 때 확인할 액션</strong>
              <ol className="number-list">
                {actionSteps.map((item) => <li key={item}>{item}</li>)}
              </ol>
            </section>
          ) : null}
        </>
      ) : null}
    </Element>
  );
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  return values.find((value) => typeof value === "string" && value.trim()) as string | undefined;
}

function getReportImages(detail: Record<string, unknown>): ReportImage[] {
  const detailPayload = getRecord(detail.detailPayload ?? detail.rawPayload);
  const request = getRecord(detailPayload.request);
  const result = getRecord(detailPayload.result);
  const sourceImageUrl = firstString(
    detail.sourceImageUrl,
    detail.originalImageUrl,
    request.sourceImageUrl,
    request.imageUrl,
    detail.imageUrl,
  );
  const previewImageUrl = firstString(detail.previewImageUrl);
  const explicitRecommendations = Array.isArray(detail.recommendedMakeupImages)
    ? detail.recommendedMakeupImages
    : [];
  const recommendedMakeups = Array.isArray(result.recommendedMakeups)
    ? result.recommendedMakeups
    : explicitRecommendations;
  const recommendedImageUrls = recommendedMakeups
    .map((item) => {
      if (typeof item === "string") return item;
      const record = getRecord(item);
      return firstString(record.imageUrl, record.cdnUrl, record.previewUrl, record.image_url);
    })
    .filter(Boolean) as string[];

  const images: ReportImage[] = [];
  if (sourceImageUrl) images.push({ label: "고객 원본 얼굴", url: sourceImageUrl });
  if (!sourceImageUrl && previewImageUrl) images.push({ label: "분석 얼굴", url: previewImageUrl });
  recommendedImageUrls.forEach((url, index) => {
    if (!images.some((image) => image.url === url)) {
      images.push({ label: index === 0 ? "AI 추천 메이크업" : `AI 추천 메이크업 ${index + 1}`, url });
    }
  });
  if (images.length === 0 && previewImageUrl) images.push({ label: "분석 얼굴", url: previewImageUrl });
  return images;
}

function getStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readableReportValue(item)).filter(Boolean);
}

function getPalette(value: unknown): Array<{ hex: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { hex: item, name: item };
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const hex = typeof record.hex === "string" ? record.hex : "#d8dddf";
      const name = typeof record.name === "string" ? record.name : hex;
      return { hex, name };
    })
    .filter(Boolean) as Array<{ hex: string; name: string }>;
}

function readableReportValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(readableReportValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.values(record).map(readableReportValue).filter(Boolean).join(" · ");
  }
  return String(value);
}
