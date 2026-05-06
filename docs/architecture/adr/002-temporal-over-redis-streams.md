# ADR-002: Temporal Over Redis Streams for Agent Orchestration

## Status: Accepted

## Context

여러 AI 워크플로와 에이전트 역할이 같은 프로젝트의 위키를 수정할 수 있다. 워크플로 간 동시성 충돌, 크래시 복구, 재시도 로직이 필요하다.

## Decision

Redis Streams 기반 큐잉 대신 Temporal을 사용한다.

## Reasoning

1. **내구성 실행**: 워커 크래시 시 마지막 완료 Activity부터 자동 재개
2. **동시성 제어**: 세마포어로 같은 프로젝트 위키에 대한 동시 수정 방지
3. **재시도 정책**: Activity별 세밀한 재시도 (횟수, 간격, 백오프)
4. **타임아웃**: Activity별/워크플로우별 타임아웃
5. **가시성**: Temporal Web UI로 워크플로우 상태/히스토리 확인
6. **스케줄링**: Cron 스케줄로 능동적 에이전트 주기 실행

## Alternatives Considered

- **Redis Streams + DB 폴링**: 단순하지만 동시성 제어 어려움, 크래시 복구 수동 구현 필요
- **Celery**: Python만 지원, 복잡한 워크플로우 표현 어려움
- **BullMQ**: Node.js만 지원, Python 워커와 호환 안 됨

## Consequences

- Docker Compose에 서비스 1개 추가 (temporalio/auto-setup)
- Temporal 학습 곡선
- Redis는 캐시/세션 용도로만 사용 (큐 역할 제거)
