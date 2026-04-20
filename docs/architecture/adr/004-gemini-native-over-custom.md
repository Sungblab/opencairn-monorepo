# ADR-004: Gemini Native APIs Over Custom Implementations

## Status: Accepted

## Context

TTS, 딥 리서치, 웹 검색, 임베딩 등의 기능을 직접 구축하거나 Gemini API 네이티브 기능을 활용할 수 있다.

## Decision

가능한 모든 곳에서 Gemini API 네이티브 기능을 사용한다.

## What We Don't Build

| 기능 | 직접 구축 안 함 | Gemini 네이티브 사용 |
|------|---------------|---------------------|
| TTS | ElevenLabs, 자체 TTS | MultiSpeakerVoiceConfig |
| Deep Research | 자체 웹 크롤러 | interactions.create() |
| 웹 검색 | Google Search API 직접 | Google Search Grounding |
| 임베딩 | sentence-transformers | gemini-embedding-001 (MRL 768d, ADR-007) |
| 추론 강화 | Chain-of-Thought 수동 구현 | ThinkingConfig |
| 비용 절감 | 자체 캐시 레이어 | Context Caching |

## Reasoning

1. **인프라 복잡도 감소**: 유지보수할 코드가 줄어듦
2. **비용 절감**: Context Caching으로 90% 절감
3. **품질**: Google의 검색/TTS/리서치가 자체 구현보다 우수
4. **속도**: API 한 줄 호출 vs 수주간 개발

## Consequences

- Gemini API에 강하게 종속 (lock-in)
- API 변경 시 영향 받음
- Gemini 외 프로바이더 지원 불가 (의도적 결정)
