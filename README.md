# consultant-web

뷰티 종합 플랫폼 앱의 전문가, 업체, 프리랜서 파트너가 고객 상담 예약과 AI 리포트를 관리하는 React 기반 웹 매니저입니다.

현재 프론트는 `src/services/api.ts`에서 FastAPI 백엔드를 직접 호출합니다. 관리자/파트너 웹 호환 API는 실제 RDS의 `consulting_*`, `analysis_reports`, `makeup_feedback_reports`, `users`, `media_assets` 테이블을 읽어 예약, 채팅, 고객, 전문가, 리포트, 상담 요약 데이터를 구성합니다. 입점 신청과 승인도 `consulting_partner_applications`, `consulting_experts`, `consulting_partner_accounts`를 하나의 RDS 흐름으로 사용합니다.

관리자와 업체/전문가 화면은 라우트와 레이아웃을 분리합니다. 운영자는 `/admin/*`, 승인된 파트너는 `/workspace/*`, 승인 전 신청자는 `/application-status`만 사용합니다.
임시 비밀번호로 승인된 파트너는 `/workspace/password`에서 새 비밀번호를 설정하기 전까지 운영 화면 접근이 제한됩니다.

## 기술 스택

- React + TypeScript
- Vite
- React Router
- TanStack React Query
- 순수 CSS 기반 UI
- `lucide-react` 아이콘

별도 UI 컴포넌트 라이브러리는 사용하지 않았습니다. 운영툴에 필요한 버튼, 배지, 드로어, 모달, 필드, 탭, 상태 화면만 `src/shared/ui`에 작게 구현했습니다.

## 실행 방법

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 `http://127.0.0.1:5173`에서 실행됩니다.

백엔드 로컬 확인:

```bash
cd backend
python -m venv .venv312
.venv312/bin/python -m pip install -r requirements.txt
PYTHONPATH=. .venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## 환경변수

로컬에서 실제 키와 비밀번호는 Git에 올리지 않는 파일에 넣습니다.

- `.env.local`: 프론트 전용. 브라우저에 노출되어도 되는 `VITE_` 값만 입력합니다.
- `backend/.env`: FastAPI 백엔드 전용. RDS, S3, AWS 키 같은 비밀값을 입력합니다.
- `.env.local.example`, `backend/.env.example`: 공유 가능한 예시 파일입니다.

프론트 기본값:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_PARTNER_EVENTS_URL=
```

현재 배포 환경에서는 Vercel 프론트가 CloudFront를 통해 ECS API를 호출하도록 아래 값을 사용합니다.

```env
VITE_API_BASE_URL=https://d3t1pbvtir1lj.cloudfront.net
```

백엔드는 RDS 접속 정보를 한 줄 `DATABASE_URL`로 두지 않고 아래처럼 나눠 관리합니다.

```env
DATABASE_SECRET_ID=
DB_HOST=
DB_PORT=5432
DB_NAME=
DB_SSLMODE=require
AWS_REGION=ap-northeast-2
AWS_USE_IAM_ROLE=true
S3_BUCKET_NAME=
```

S3는 같은 버킷을 공유하더라도 `user-reports/`, `business-verifications/`, `credentials/`처럼 prefix를 분리해서 사용합니다.

## 배포

- Frontend: Vercel
  - Production URL: `https://consultant-web-rose.vercel.app`
  - Framework: Vite
  - Build command: `npm run build`
  - Output directory: `dist`
- Backend API: AWS ECS Fargate
  - Cluster: `aura-backend-dev`
  - Service: `consultant-web-api`
  - Container port: `8000`
  - External API base URL: `https://d3t1pbvtir1lj.cloudfront.net`
  - Manager API health check: `https://d3t1pbvtir1lj.cloudfront.net/api/manager/status`

Vercel에는 프론트만 배포합니다. `backend/`는 ECS 배포용 코드라 `.vercelignore`에서 제외합니다.

개발 중에는 프론트와 백엔드를 로컬에서 띄워서 확인하고, 기능이 안정된 시점에만 Vercel/ECS로 배포합니다. 자세한 흐름은 [로컬 개발과 배포 흐름](docs/development-deployment-workflow.md)을 참고합니다.

프로덕션 빌드 확인:

```bash
npm run build
```

## 구현된 주요 화면

- 로그인/입장: 관리자 로그인, 업체/전문가 로그인, 입점 신청 분기
- 입점 신청: 업체/프리랜서 정보와 필수 사업자등록증 PDF 제출, 국가 미용사 면허증·추가 자격증 PDF 선택 제출 UI
- 입점 심사: 관리자 신청 목록, 상태 필터, 상세 드로어, 서류 열람, 보완 요청/반려/승인 및 계정 생성
- 신청 상태: 승인 전 업체/전문가가 로그인하면 운영 메뉴 대신 검토 대기/보완 요청/반려 상태 확인
- 대시보드: 오늘 앱 예약, 오늘 결제액, 리포트 전달 대기, 사업자 인증 상태, 미응답 메시지, 30분 슬롯 재고
- 예약 관리: 월/주/일 캘린더, 10:00-20:00 30분 슬롯, 가능 시간/휴무/점심/예외 시간 조정, 예약 상세 드로어
- 고객 리포트 관리: 검색/태그/최근 활동/정렬, 고객 상세 드로어, 앱 선택 리포트, 예약 이력, 처방 노트, 첨부 이력
- 고객 대화: 대화 목록, 채팅창, 고객 프로필, 앱 예약 정보, 선택 리포트, 연락 action placeholder
- 상담 완료/처방 노트 전달: 내부 메모, 고객용 뷰티 처방 노트, 추천사항, 전달 리포트 선택, 완료 상태 및 리뷰 요청 상태 갱신
- 리뷰 관리: 완료 예약 연결 리뷰 조회, 별점/상태/날짜/정렬 필터, 숨김/신고/답글 UI
- 파트너/전문가 관리: 업체 정보, 사업자 인증 문서, 전문가 프로필, 가격, 전문 분야, 노출 상태, 자격증 업로드 UI
- 설정: 영업시간, 휴무일, 취소/환불 정책, 알림, 계정 권한, 전화/SMS/채팅 연동 placeholder

## 프로젝트 구조

```text
src/
  app/                 # 라우팅과 앱 레이아웃
  features/            # 페이지 단위 기능
  services/            # FastAPI 연동과 실제 데이터 캐시
  shared/ui/           # 재사용 UI 컴포넌트
  shared/utils/        # 포맷터와 옵션 유틸
  types/               # 도메인 타입
```

## 백엔드 연동 계획

현재 서비스 함수 예시는 다음처럼 실제 API 함수명에 가깝게 설계했습니다.

- `getBookings`
- `updateBookingStatus`
- `getCustomerDetail`
- `sendMessage`
- `updateAvailability`
- `uploadCredentialMock`
- `uploadBusinessVerificationMock`
- `createConsultationSummary`
- `submitPartnerApplication`
- `getPartnerApplications`
- `approvePartnerApplication`
- `preparePartnerApplicationDocumentAccess`

추후 연동 시 `src/services/api.ts` 내부 구현만 FastAPI 엔드포인트 호출로 교체하면 됩니다.

입점 심사 백엔드 초안:

- FastAPI router: `backend/app/routers/applications.py`
- Admin/partner router: `backend/app/routers/admin.py`, `backend/app/routers/partner.py`
- Pydantic schema: `backend/app/schemas/partner_applications.py`
- Partner application service: `backend/app/services/partner_applications.py`
- RDS SQL draft: `backend/db/partner_applications_schema.sql`

운영자/파트너 API prefix:

- Applicant: `POST /api/partner-applications`, `GET /api/partner-applications/{application_id}/status`
- Admin: `/api/admin/dashboard`, `/api/admin/partner-applications`, `/api/admin/partner-applications/{application_id}/needs-update`, `/api/admin/partner-applications/{application_id}/reject`, `/api/admin/partner-applications/{application_id}/approve`, `/api/admin/partner-applications/documents/{document_id}/access`, `/api/admin/businesses`, `/api/admin/bookings`, `/api/admin/summary-jobs`
- Partner: `/api/partner/me`, `/api/partner/me/password`, `/api/partner/dashboard`, `/api/partner/bookings`, `/api/partner/customers`, `/api/partner/chats`, `/api/partner/consultations/{booking_id}/summary`, `/api/partner/events`
- Partner web compat: `/api/consulting/partner/login`, `/api/consulting/partner/dashboard`, `/api/consulting/partner/bookings`, `/api/consulting/partner/chat/threads`, `/api/consulting/partner/shared-reports`, `/api/consulting/partner/summaries/{booking_id}/generate`
- Partner event debug: `/api/partner/events/snapshot`
- Customer app summary: `/api/consulting/bookings/{booking_id}/summary`

백엔드 API는 운영자 요청에 `X-Admin-Id`와 `X-Aura-Role`을 요구합니다. 웹 프론트가 쓰는 `/api/consulting/partner` 호환 API는 실제 `consulting_partner_accounts` 행에서 발급한 `Bearer partner:{account_id}` 세션 토큰과 `{ data, error }` envelope를 사용합니다. `expert_personal` scope는 계정의 `expert_id` 범위로 제한됩니다.
입점 신청자의 public API는 제출과 제한된 상태 조회만 허용하고, 서류 presigned URL, 전체 목록, 상세 검토 로그, 승인/반려는 admin API 뒤에 둡니다.

파트너 고객 조회는 별도 고객 복사본을 만들지 않고 `consulting_bookings -> consulting_experts -> users` 관계로 계산합니다. 현재 운영 DB에서는 파트너 범위를 `expert_id`로 제한하고, 웹 도메인의 `business_id`는 해당 `expert_id`와 동일한 scope id로 매핑합니다.
고객 앱 요약 조회는 `consulting_summaries.visible_to_customer=true`와 `consulting_bookings.status='completed'`를 동시에 만족하는 저장 요약만 반환합니다. DB 초안에는 이 기준을 고정하는 `customer_visible_consulting_summaries` view가 포함되어 있습니다.

파트너 이벤트 스트림은 브라우저 `EventSource` 제약 때문에 header 외에도 `accountId`, `role`, `businessId`, `expertId`, `workspaceScope` query를 받을 수 있습니다. 새 앱 예약/예약 변경 이벤트는 `expert_id`에서 workspace scope를 계산한 뒤 해당 전문가에게만 전달됩니다.
RDS 초안에는 `partner_event_outbox`가 포함되어 있어 예약/요약/리뷰/환불/미읽은 채팅 이벤트를 업체·전문가 scope와 증가 sequence로 저장하고, SSE 재연결 시 `Last-Event-ID` 또는 `afterId` cursor 이후 이벤트를 replay할 수 있습니다. 채팅 본문은 기존 상담 WebSocket을 유지하고, 대시보드 갱신 이벤트만 별도 stream으로 분리합니다.
SSE가 끊기거나 이벤트 cursor를 놓친 경우에는 공통 fallback refetch root로 대시보드, 예약, 상담 완료 후보, 채팅 목록, 리뷰, AI 요약 작업 목록을 재조회합니다.

백엔드 scope/summary 계약 smoke check:

```bash
python3 backend/scripts/smoke_partner_contract.py
```

이 smoke check는 입점 승인 중간 실패 시 business/expert/account/document/log 변경이 남지 않는 롤백 계약도 검증합니다.
승인 성공 시에는 `business`, `expert`, `partner_account`, `business_member`, 검증된 문서 상태와 review log가 같은 트랜잭션 단위로 생성되는 계약입니다.
RDS 초안은 `partner_account`와 `business_member`의 role/workspace/expert scope 조합을 check constraint로 고정하고, member가 다른 business의 account를 참조하지 못하도록 composite FK를 둡니다.
승인 계정의 첫 로그인 비밀번호 변경은 `/api/partner/me/password`에서 자기 account/business/expert scope를 확인한 뒤 `password_change_required=false`와 `status=active`로 전환합니다.

프론트 라우트/권한과 partner event invalidation 계약 확인:

```bash
node scripts/verify-role-split.mjs http://127.0.0.1:9223 http://127.0.0.1:5173
node scripts/verify-partner-event-rules.mjs
```

PDF 서류는 public URL을 저장하지 않고, private S3 `storage_key`만 저장한 뒤 관리자 열람 시 짧은 시간의 presigned URL을 발급하는 방식으로 설계했습니다.

권장 백엔드 확장 방향:

- 인증/권한: FastAPI auth + role 기반 route guard
- DB: AWS RDS Postgres에 Expert, BusinessProfile, PartnerVerification, Customer, Booking, AvailabilitySlot, ChatThread, SharedReport, Review 테이블 구성
- 파일: 사업자등록증/자격증/사진은 S3 presigned URL 발급 후 프론트에서 업로드
- 업체 인증: 사업자등록증 OCR, 대표자 확인, 정산 계좌 검증, 관리자 승인 플로우
- 채팅: FastAPI WebSocket, Firebase, Sendbird, Stream 중 선택 가능
- 전화/SMS: Twilio, AWS Pinpoint, Naver Cloud SENS action API로 연결
- 배포: 정적 프론트는 Vercel, API는 AWS ECS Fargate 기준으로 운영하고 필요 시 도메인과 HTTPS 인증서를 별도로 연결
