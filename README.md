# consultant-web

뷰티 종합 플랫폼 앱의 전문가, 업체, 프리랜서 파트너가 고객 상담 예약과 AI 리포트를 관리하는 React 기반 웹 매니저입니다.

현재는 백엔드 없이 동작하는 프론트엔드 중심 구현이며, 모든 데이터 접근은 `src/services/api.ts`의 mock service layer를 통합니다. 추후 FastAPI + AWS RDS Postgres + AWS 배포 환경으로 교체하기 쉽게 화면에서 mock 데이터를 직접 import하지 않도록 분리했습니다.

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

프로덕션 빌드 확인:

```bash
npm run build
```

## 구현된 주요 화면

- Mock 로그인: 첫 진입에서 플랫폼 관리자와 업체/프리랜서 파트너 분기, 사업자등록증/자격증 mock 인증 제출
- 대시보드: 오늘 앱 예약, 오늘 결제액, 리포트 전달 대기, 사업자 인증 상태, 미응답 메시지, 30분 슬롯 재고
- 예약 관리: 월/주/일 캘린더, 10:00-20:00 30분 슬롯, 가능 시간/휴무/점심/예외 시간 조정, 예약 상세 드로어
- 고객 리포트 관리: 검색/태그/최근 활동/정렬, 고객 상세 드로어, 앱 선택 리포트, 예약 이력, 처방 노트, 첨부 이력
- 고객 대화: 대화 목록, 채팅창, 고객 프로필, 앱 예약 정보, 선택 리포트, 연락 action placeholder
- 상담 완료/처방 노트 전달: 내부 메모, 고객용 뷰티 처방 노트, 추천사항, 전달 리포트 선택, 완료 상태 및 리뷰 요청 상태 갱신
- 리뷰 관리: 완료 예약 연결 리뷰 조회, 별점/상태/날짜/정렬 필터, 숨김/신고/답글 UI
- 파트너/전문가 관리: 업체 정보, 사업자 인증 문서, 전문가 프로필, 가격, 전문 분야, 노출 상태, 자격증 mock 업로드
- 설정: 영업시간, 휴무일, 취소/환불 정책, 알림, 계정 권한, 전화/SMS/채팅 연동 placeholder

## 프로젝트 구조

```text
src/
  app/                 # 라우팅과 앱 레이아웃
  features/            # 페이지 단위 기능
  services/            # API 교체 지점과 mock 데이터
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

추후 연동 시 `src/services/api.ts` 내부 구현만 FastAPI 엔드포인트 호출로 교체하면 됩니다.

권장 백엔드 확장 방향:

- 인증/권한: FastAPI auth + role 기반 route guard
- DB: AWS RDS Postgres에 Expert, BusinessProfile, PartnerVerification, Customer, Booking, AvailabilitySlot, ChatThread, SharedReport, Review 테이블 구성
- 파일: 사업자등록증/자격증/사진은 S3 presigned URL 발급 후 프론트에서 업로드
- 업체 인증: 사업자등록증 OCR, 대표자 확인, 정산 계좌 검증, 관리자 승인 플로우
- 채팅: FastAPI WebSocket, Firebase, Sendbird, Stream 중 선택 가능
- 전화/SMS: Twilio, AWS Pinpoint, Naver Cloud SENS action API로 연결
- 배포: 정적 프론트는 Vercel/S3+CloudFront, API는 AWS ECS/App Runner/Lambda 중 운영 규모에 맞게 선택
