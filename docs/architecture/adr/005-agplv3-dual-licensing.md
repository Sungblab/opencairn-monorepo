# ADR-005: AGPLv3 + CLA with Dual Licensing Path

## Status: Accepted

## Context

오픈소스로 공개하되, SaaS 재판매를 방지하고 향후 엔터프라이즈 시장 진출이 가능해야 한다.

## Decision

AGPLv3 + CLA(기여자 라이선스 동의)를 채택하고, 향후 듀얼 라이선싱을 준비한다.

## Reasoning

1. **AGPLv3**: 네트워크 사용 시에도 소스 공개 의무 → SaaS 재판매 방지
2. **CLA**: 기여자의 저작권을 모기업에 귀속 → 듀얼 라이선싱 법적 기반
3. **듀얼 라이선싱**: 엔터프라이즈 고객에게 AGPL 감염 우려 없는 상용 라이선스 판매 가능

## Precedents

- MongoDB: SSPL + 상용 라이선스
- GitLab: CE (MIT) + EE (Proprietary)
- Elastic: SSPL → 듀얼 라이선싱

## Consequences

- 모든 PR에 CLA 서명 필요 (CLA bot)
- 엔터프라이즈 고객은 AGPL 때문에 셀프호스팅 주저할 수 있음 → 상용 라이선스로 해결
- 커뮤니티가 AGPL을 꺼릴 수 있음 → 실제로는 셀프호스팅/개인 사용에 영향 없음
