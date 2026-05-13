export type ChatIntent = {
  freshnessRequired: boolean;
  workspaceGrounded: boolean;
  toolAction: boolean;
  ambiguous: boolean;
  highRisk: boolean;
  researchDepth: boolean;
};

const FRESHNESS_RE =
  /(오늘|현재|최신|최근|방금|지금|뉴스|가격|주가|환율|일정|법|규정|릴리즈|버전|current|latest|recent|today|now|news|price|stock|exchange rate|schedule|law|regulation|release|version)/i;

const WORKSPACE_RE =
  /(내 문서|내 노트|이 문서|이 노트|이 프로젝트|워크스페이스|첨부|위키|자료|강의자료|파일|pdf|workspace|project|note|document|attached|wiki)/i;

const TOOL_ACTION_RE =
  /(저장|생성|수정|삭제|보내|정리|요약|노트|만들|import|가져와|업로드|초대|메일|이메일|save|create|update|delete|send|summarize|import|upload|invite|email)/i;

const HIGH_RISK_RE =
  /(삭제|외부|메일|이메일|초대|공유|결제|대량|delete|external|email|invite|share|billing|payment|bulk)/i;

const RESEARCH_RE =
  /(조사|리서치|근거 기반|비교|분석|출처|논문|시장|자세히|상세|강의노트|정리 노트|due diligence|research|investigate|compare|analysis|sources|literature|market)/i;

export function classifyChatIntent(input: string): ChatIntent {
  const text = input.trim();
  const freshnessRequired = FRESHNESS_RE.test(text);
  const workspaceGrounded = WORKSPACE_RE.test(text);
  const toolAction = TOOL_ACTION_RE.test(text);
  const researchDepth = RESEARCH_RE.test(text);

  return {
    freshnessRequired,
    workspaceGrounded,
    toolAction,
    ambiguous: text.length <= 3 || /^(해줘|ㄱㄱ|go|do it)$/i.test(text),
    highRisk: HIGH_RISK_RE.test(text),
    researchDepth,
  };
}
