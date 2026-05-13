import {
  ZoomMode,
  type Locale,
  type PDFViewerConfig,
} from "@embedpdf/react-pdf-viewer";

const ENGLISH_ZOOM_PRESETS = [
  { name: "75%", value: 0.75 },
  { name: "90%", value: 0.9 },
  { name: "100%", value: 1 },
  { name: "125%", value: 1.25 },
  { name: "150%", value: 1.5 },
  { name: "Fit width", value: ZoomMode.FitWidth },
  { name: "Fit page", value: ZoomMode.FitPage },
] satisfies NonNullable<PDFViewerConfig["zoom"]>["presets"];

const KOREAN_ZOOM_PRESETS = [
  { name: "75%", value: 0.75 },
  { name: "90%", value: 0.9 },
  { name: "100%", value: 1 },
  { name: "125%", value: 1.25 },
  { name: "150%", value: 1.5 },
  { name: "너비에 맞춤", value: ZoomMode.FitWidth },
  { name: "페이지에 맞춤", value: ZoomMode.FitPage },
] satisfies NonNullable<PDFViewerConfig["zoom"]>["presets"];

export const EMBEDPDF_STABLE_ZOOM_CONFIG = {
  defaultZoomLevel: ZoomMode.FitWidth,
  minZoom: 0.5,
  maxZoom: 3,
  zoomStep: 0.05,
  zoomRanges: [
    { min: 0.5, max: 1, step: 0.05 },
    { min: 1, max: 2, step: 0.1 },
    { min: 2, max: 3, step: 0.25 },
  ],
  presets: ENGLISH_ZOOM_PRESETS,
} satisfies NonNullable<PDFViewerConfig["zoom"]>;

export function embedPdfZoomConfig(
  locale: string,
): NonNullable<PDFViewerConfig["zoom"]> {
  return {
    ...EMBEDPDF_STABLE_ZOOM_CONFIG,
    presets: locale.toLowerCase().startsWith("ko")
      ? KOREAN_ZOOM_PRESETS
      : ENGLISH_ZOOM_PRESETS,
  };
}

export const EMBEDPDF_SELF_CONTAINED_CONFIG = {
  fonts: {
    ui: null,
    signature: null,
  },
  stamp: {
    defaultLibrary: false,
    manifests: [],
    libraries: [],
  },
} satisfies Pick<PDFViewerConfig, "fonts" | "stamp">;

export const EMBEDPDF_DISABLED_EDIT_CATEGORIES = [
  "shapes",
  "form",
  "insert",
  "redaction",
  "redact",
  "signature",
  "stamp",
] as const;

export const EMBEDPDF_PEN_ANNOTATION_CONFIG = {
  autoCommit: true,
  annotationAuthor: "OpenCairn",
  deactivateToolAfterCreate: false,
  selectAfterCreate: false,
  colorPresets: [
    "#2563eb",
    "#ef4444",
    "#f59e0b",
    "#22c55e",
    "#111827",
    "#ffffff",
  ],
  tools: [
    {
      id: "ink",
      defaults: {
        strokeColor: "#2563eb",
        color: "#2563eb",
        strokeWidth: 2,
        opacity: 1,
      },
    },
    {
      id: "inkHighlighter",
      defaults: {
        strokeColor: "#facc15",
        color: "#facc15",
        strokeWidth: 10,
        opacity: 0.35,
      },
    },
    {
      id: "highlight",
      defaults: {
        strokeColor: "#facc15",
        color: "#facc15",
        opacity: 0.35,
      },
    },
  ],
} satisfies NonNullable<PDFViewerConfig["annotations"]>;

const KOREAN_EMBEDPDF_LOCALE: Locale = {
  code: "ko",
  name: "한국어",
  translations: {
    toolbar: {
      open: "열기",
      close: "닫기",
      print: "인쇄",
      protect: "보안",
      security: "보안",
      screenshot: "스크린샷",
      export: "내보내기",
      fullscreen: "전체 화면",
      loading: "문서를 불러오는 중...",
    },
    commands: {
      menu: "메뉴",
      sidebar: "사이드바",
      search: "검색",
      comment: "댓글",
      download: "다운로드",
      print: "인쇄",
      openFile: "파일 열기",
      save: "저장",
      settings: "설정",
      view: "보기",
      annotate: "주석",
      shapes: "도형",
      redact: "가리기",
      fillAndSign: "채우기 및 서명",
      fullscreen: {
        enter: "전체 화면",
        exit: "전체 화면 종료",
      },
      rotate: {
        clockwise: "시계 방향 회전",
        counterclockwise: "반시계 방향 회전",
      },
      zoom: {
        in: "확대",
        out: "축소",
        fitWidth: "너비에 맞춤",
        fitPage: "페이지에 맞춤",
        automatic: "자동",
        level: "{zoom}%",
        inArea: "영역 확대",
      },
      history: {
        undo: "실행 취소",
        redo: "다시 실행",
      },
      page: {
        next: "다음 페이지",
        previous: "이전 페이지",
        first: "첫 페이지",
        last: "마지막 페이지",
      },
      selection: {
        select: "선택",
        hand: "손 도구",
        pan: "이동",
      },
    },
    selection: {
      copy: "복사",
    },
    mode: {
      view: "보기",
      annotate: "주석",
      shapes: "도형",
      form: "양식",
      redact: "가리기",
      insert: "삽입",
    },
    insert: {
      rubberStamp: "스탬프",
      signature: "서명",
      image: "이미지",
      text: "텍스트",
      freeText: "텍스트",
      ink: "펜",
      highlight: "형광펜",
      drawing: "그리기",
    },
    panel: {
      sidebar: "사이드바",
      search: "검색",
      comment: "댓글",
      thumbnails: "썸네일",
      outline: "목차",
      annotationStyle: "주석 스타일",
      redaction: "가리기",
    },
    menu: {
      viewControls: "보기 설정",
      zoomControls: "확대/축소",
      moreOptions: "더 보기",
    },
    document: {
      menu: "문서 메뉴",
      open: "열기",
      close: "닫기",
      print: "인쇄",
      protect: "보안",
      export: "내보내기",
      fullscreen: "전체 화면",
      loading: "문서를 불러오는 중...",
    },
    page: {
      settings: "페이지 설정",
      single: "한 페이지",
      twoOdd: "두 페이지",
      twoEven: "두 페이지",
      vertical: "세로 스크롤",
      horizontal: "가로 스크롤",
      spreadMode: "펼침 모드",
      scrollLayout: "스크롤 방식",
      rotation: "회전",
      next: "다음 페이지",
      previous: "이전 페이지",
    },
    search: {
      placeholder: "문서에서 검색",
      caseSensitive: "대소문자 구분",
      wholeWord: "단어 단위",
      resultsFound: "{count}개 결과",
      page: "{page}페이지",
      noResults: "검색 결과 없음",
      next: "다음 결과",
      previous: "이전 결과",
      clear: "검색어 지우기",
    },
    zoom: {
      in: "확대",
      out: "축소",
      fitWidth: "너비에 맞춤",
      fitPage: "페이지에 맞춤",
      automatic: "자동",
      menu: "확대/축소 메뉴",
      level: "{zoom}%",
      dragTip: "확대할 영역을 드래그하세요.",
    },
    common: {
      close: "닫기",
      back: "뒤로",
      cancel: "취소",
      apply: "적용",
      delete: "삭제",
      save: "저장",
      loading: "불러오는 중...",
      confirm: "확인",
      reset: "초기화",
      enabled: "사용",
      disabled: "사용 안 함",
    },
    print: {
      title: "인쇄 설정",
      print: "인쇄",
      cancel: "취소",
    },
    protect: {
      title: "문서 보안",
      password: "비밀번호",
      apply: "적용",
      cancel: "취소",
    },
    capture: {
      screenshot: "스크린샷",
      copy: "복사",
      download: "다운로드",
    },
    export: {
      title: "내보내기",
      download: "다운로드",
    },
    comments: {
      emptyState: "아직 댓글이 없습니다.",
      addComment: "댓글 추가",
      addReply: "답글 추가",
      page: "{page}페이지",
      commentCount: "댓글 {count}개",
      commentCountPlural: "댓글 {count}개",
      showAllAnnotations: "모든 주석 보기",
      closeAllAnnotations: "모든 주석 닫기",
    },
    annotation: {
      defaults: "기본 주석",
      selectAnnotation: "주석을 선택하세요.",
      fillColor: "채우기 색",
      strokeColor: "선 색",
      opacity: "불투명도",
      strokeWidth: "선 두께",
      borderStyle: "테두리 스타일",
      fontFamily: "글꼴",
      fontSize: "글자 크기",
      fontColor: "글자 색",
      textAlign: "텍스트 정렬",
      verticalAlign: "세로 정렬",
      blendMode: "혼합 모드",
      rotation: "회전",
      overlayText: "오버레이 텍스트",
      overlayTextPlaceholder: "텍스트 입력",
    },
    redaction: {
      mark: "가릴 영역 표시",
      apply: "가리기 적용",
      cancel: "취소",
    },
  },
};

export function embedPdfI18nConfig(
  locale: string,
): NonNullable<PDFViewerConfig["i18n"]> | undefined {
  if (!locale.toLowerCase().startsWith("ko")) return undefined;

  return {
    defaultLocale: "ko",
    fallbackLocale: "en",
    locales: [KOREAN_EMBEDPDF_LOCALE],
  };
}
