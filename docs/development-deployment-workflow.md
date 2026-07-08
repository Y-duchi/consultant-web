# 로컬 개발과 배포 흐름

이 프로젝트는 개발 중에는 로컬 서버로 확인하고, 최종 확인이 끝났을 때만 프론트와 백엔드를 배포한다.

## 기본 원칙

- 프론트 개발: 로컬 Vite 서버에서 확인한다.
- 백엔드 개발: 로컬 FastAPI 서버에서 확인한다.
- 프론트 배포: GitHub push 후 Vercel이 배포한다.
- 백엔드 배포: Docker 이미지 빌드, ECR push, ECS 서비스 재배포로 진행한다.
- RDS, S3, Secrets 값은 배포 환경과 로컬 환경에서 같은 이름을 쓰되 실제 비밀값은 Git에 올리지 않는다.

## 로컬 개발

프론트는 보통 `http://127.0.0.1:5173`에서 실행한다.

```bash
npm run dev
```

백엔드는 보통 `http://127.0.0.1:8000`에서 실행한다.

```bash
cd backend
.venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

로컬 프론트가 로컬 백엔드를 바라보도록 `.env.local`에는 아래처럼 둔다.

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

백엔드의 RDS, S3, AWS, OpenAI 관련 값은 `backend/.env`에만 넣는다.

## 브랜치별 Vercel 배포

- `main`에 push하면 Production 배포가 생성된다.
- `consulting-page`나 다른 브랜치에 push하면 Preview 배포가 생성된다.
- Preview는 테스트 링크이고, Production은 실제 사용자에게 보여줄 링크다.

개발 중에는 `consulting-page`에서 확인하고, 안정화된 변경만 `main`으로 merge한다.

## 백엔드 배포

백엔드는 GitHub push만으로 끝나지 않는다. 최종 확인 후에만 아래 흐름으로 배포한다.

1. Docker 이미지 빌드
2. ECR에 이미지 push
3. ECS Task Definition 또는 서비스 업데이트
4. ECS가 새 Task를 띄움
5. 헬스체크 통과 후 기존 Task 종료

백엔드가 바뀌지 않은 프론트 수정이라면 ECS 재배포는 필요 없다.

## 정리

- 프론트만 바뀜: 로컬 확인 후 GitHub push, Vercel 배포 확인
- 백엔드만 바뀜: 로컬 확인 후 Docker/ECR/ECS 재배포
- 프론트와 백엔드 모두 바뀜: 로컬에서 같이 확인 후 프론트는 Vercel, 백엔드는 ECS로 각각 배포
- DB 스키마 변경: 공유 RDS에 바로 적용하지 말고 disposable DB나 로컬에서 먼저 검증
