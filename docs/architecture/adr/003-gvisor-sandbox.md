# ADR-003: gVisor Runtime for Code Sandbox

## Status: Accepted

## Context

AI가 생성한 임의의 코드를 실행하는 샌드박스가 필요하다. 일반 Docker 컨테이너는 호스트 커널을 공유하므로 컨테이너 탈출 위험이 있다.

## Decision

Sandbox 컨테이너에 gVisor(runsc) 런타임을 적용한다.

## Reasoning

1. **커널 격리**: gVisor가 시스템 콜을 인터셉트하여 호스트 커널에 닿지 않음
2. **Docker 호환**: `runtime: runsc` 한 줄로 적용, 기존 Dockerfile 변경 불필요
3. **셀프호스팅 친화적**: VM 없이 Docker만으로 보안 강화 가능
4. **성능**: MicroVM보다 오버헤드 적음, 서브세컨드 콜드 스타트

## Alternatives Considered

- **일반 Docker + privileged:false**: 커널 공유 리스크 남음
- **Firecracker MicroVM**: 최고 격리지만 셀프호스팅 환경에서 설정 복잡
- **E2B (클라우드)**: SaaS에는 좋지만 셀프호스팅 불가

## Consequences

- 호스트에 gVisor 설치 필요 (`apt install runsc`)
- 일부 시스템 콜 미지원 가능 (대부분 Python/JS에는 문제 없음)
- SaaS 버전에서는 추후 E2B/Firecracker로 업그레이드 가능
