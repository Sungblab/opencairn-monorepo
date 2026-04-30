# ADR-005: AGPLv3 + CLA with Dual Licensing

## Status: Accepted (initial AGPL+CLA path 2026-04-09; dual licensing **activated** 2026-04-30 via commit `cbe8f5f`)

## Context

오픈소스로 공개하되, SaaS 재판매를 방지하고 엔터프라이즈 시장(특히 한국 대기업·금융·공공처럼 내부 OSS 정책상 AGPL 컴포넌트 자동 거부 사례가 많은 환경)에도 진입 가능해야 한다.

## Decision

AGPLv3 + 개인 CLA(Contributor License Agreement) + 듀얼 라이선싱을 채택. 2026-04-30 시점 듀얼이 실제로 활성화됨:

- `LICENSE` — AGPL-3.0-or-later (GitHub auto-detection 보존)
- `LICENSE-COMMERCIAL.md` — 상용 라이선스 프로그램 설명 (라이선스 텍스트 자체는 아님; GitHub Discussion + 임시 이메일 → 향후 `licensing@opencairn.com`)
- `CLA.md` — Apache ICLA 변형 Individual CLA v1.0. §2 "any license terms, including but not limited to AGPL-3.0-or-later and proprietary commercial licenses" 조항이 듀얼 라이선싱의 법적 기반
- 수락은 commit trailer `OpenCairn-CLA: accepted v1.0` + Signed-off-by, 외부 PR 도착 시점에 CLA-Assistant bot 활성화

## Reasoning

1. **AGPLv3**: 네트워크 사용 시에도 소스 공개 의무 → 무단 SaaS 재판매 방지
2. **CLA**: 기여자가 프로젝트에 듀얼 배포 권리를 부여 → 향후 라이선스 결합 가능성을 닫지 않음 (저작권은 기여자가 보유, 프로젝트는 광범위한 라이선스 권한을 받음)
3. **상용 라이선스**: 시장조사(`docs/architecture/market-and-competitive-deep-research-2026-04-30.md` §4.2 §5.2 §6 P2)에서 한국·서구 대기업 OSS 정책이 AGPL을 자동 거부하는 패턴이 확인됨. 코드베이스가 작고 저작권이 집중된 시점에 듀얼 도입이 가장 저비용

## Precedents

- MongoDB: SSPL + 상용 라이선스
- GitLab: CE (MIT) + EE (Proprietary)
- Elastic: SSPL → 듀얼 라이선싱
- Cal.com: AGPL + `/ee` 디렉토리 분리 (1% closed core)

## Consequences

- 비-trivial 기여 PR에는 CLA 수락 필요 (현 시점 contributors는 Sungblab + dependabot — bot 활성화는 첫 외부 PR 시까지 deferred)
- 엔터프라이즈 고객은 AGPL 우려 시 상용 라이선스로 전환 가능 → 셀프호스팅 진입 장벽 해소
- 커뮤니티 AGPL 거부감은 셀프호스팅/개인 사용에는 영향 없음 (네트워크 서비스 제3자 제공이 트리거)
- `LICENSE-COMMERCIAL.md`와 CLA 텍스트는 baseline 템플릿. 중대 상업 결정 시 별도 법률 검토 필요
