# ADR-001: Hono as Separate Backend Over Next.js API Routes

## Status: Accepted

## Context

Next.js는 Server Actions과 API Routes를 제공하여 프론트엔드와 백엔드를 하나로 합칠 수 있다. 하지만 OpenCairn은 AI 중심 워크로드를 Docker 셀프호스팅으로 제공해야 한다.

## Decision

Next.js는 UI만 담당하고, 모든 비즈니스 로직은 Hono 백엔드 서버에 둔다.

## Reasoning

1. **Docker 셀프호스팅**: Vercel에 종속되지 않으므로 Next.js 서버리스 이점이 없음
2. **API 재사용**: 나중에 모바일 앱, CLI 등 다른 클라이언트가 같은 API 사용 가능
3. **프론트/백엔드 분리**: 오픈소스 기여자가 독립적으로 작업 가능
4. **안정성**: AI 처리 부하가 웹서버에 영향 주지 않음

## Consequences

- 프론트엔드에서 API 호출 레이어 필요 (TanStack Query)
- CORS 설정 필요
- 배포 시 서비스 2개 관리
