"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Difficulty = "easy" | "medium" | "hard";

type Question = {
  text: string;
  hint: string | null;
  difficulty: Difficulty;
};

type Evaluation = {
  score: number;
  is_correct: boolean;
  feedback: string;
  should_create_flashcard: boolean;
};

type Stage = "input" | "questions" | "answering" | "result";

type SocraticSessionProps = {
  projectId: string;
  initialConcept?: string;
  initialNoteContext?: string;
};

export function SocraticSession({
  projectId,
  initialConcept = "",
  initialNoteContext = "",
}: SocraticSessionProps) {
  const t = useTranslations("learn.socratic");
  const tQuality = useTranslations("learn.socratic.difficulty");

  const [stage, setStage] = useState<Stage>("input");
  const [concept, setConcept] = useState(initialConcept);
  const [noteContext, setNoteContext] = useState(initialNoteContext);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showHint, setShowHint] = useState(false);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const selectedQuestion = questions[selectedIndex];

  async function generate() {
    if (!concept.trim()) return;
    setPending(true);
    setErrorKey(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/socratic/generate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conceptName: concept.trim(),
            noteContext: noteContext.slice(0, 8000),
          }),
        },
      );
      if (!res.ok) {
        setErrorKey(res.status === 403 ? "errors.forbidden" : "errors.generic");
        return;
      }
      const data = (await res.json()) as { questions?: Question[] };
      const list = Array.isArray(data.questions) ? data.questions : [];
      if (list.length === 0) {
        setErrorKey("errors.no_questions");
        return;
      }
      setQuestions(list);
      setSelectedIndex(0);
      setShowHint(false);
      setAnswer("");
      setEvaluation(null);
      setStage("questions");
    } catch {
      setErrorKey("errors.network");
    } finally {
      setPending(false);
    }
  }

  async function evaluate() {
    if (!selectedQuestion || !answer.trim()) return;
    setPending(true);
    setErrorKey(null);
    setStage("answering");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/socratic/evaluate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conceptName: concept.trim(),
            question: selectedQuestion.text,
            userAnswer: answer.trim(),
            noteContext: noteContext.slice(0, 8000),
          }),
        },
      );
      if (!res.ok) {
        setErrorKey(res.status === 403 ? "errors.forbidden" : "errors.generic");
        setStage("questions");
        return;
      }
      const data = (await res.json()) as Evaluation;
      setEvaluation(data);
      setStage("result");
    } catch {
      setErrorKey("errors.network");
      setStage("questions");
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setStage("input");
    setQuestions([]);
    setSelectedIndex(0);
    setShowHint(false);
    setAnswer("");
    setEvaluation(null);
    setErrorKey(null);
  }

  function pickQuestion(index: number) {
    setSelectedIndex(index);
    setShowHint(false);
    setAnswer("");
  }

  if (stage === "input") {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold mb-2">{t("input.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("input.subtitle")}</p>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t("input.empty_guide")}
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("input.concept_label")}</span>
          <input
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && concept.trim() && !pending) {
                e.preventDefault();
                void generate();
              }
            }}
            placeholder={t("input.concept_placeholder")}
            maxLength={200}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("input.note_label")}</span>
          <textarea
            value={noteContext}
            onChange={(e) => setNoteContext(e.target.value)}
            placeholder={t("input.note_placeholder")}
            rows={6}
            maxLength={8000}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">
            {t("input.note_hint")}
          </span>
        </label>
        {errorKey && (
          <p className="text-sm text-destructive" role="alert">
            {t(errorKey)}
          </p>
        )}
        <button
          onClick={generate}
          disabled={pending || !concept.trim()}
          className="self-end px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? t("input.generating") : t("input.generate")}
        </button>
      </div>
    );
  }

  if (stage === "result" && evaluation) {
    const tone =
      evaluation.score >= 80
        ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30"
        : evaluation.score >= 60
          ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
          : "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30";
    return (
      <div className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold">{t("result.title")}</h2>
        <div className={`rounded-xl border p-5 flex items-center justify-between ${tone}`}>
          <div>
            <p className="text-xs uppercase tracking-wider opacity-70">
              {t("result.score_label")}
            </p>
            <p className="text-4xl font-bold mt-1">{evaluation.score}</p>
          </div>
          <p className="text-sm font-semibold">
            {evaluation.is_correct
              ? t("result.is_correct_true")
              : t("result.is_correct_false")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t("result.question_label")}
          </p>
          <p className="text-sm whitespace-pre-wrap">{selectedQuestion?.text}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t("result.your_answer_label")}
          </p>
          <p className="text-sm whitespace-pre-wrap text-card-foreground">{answer}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            {t("result.feedback_label")}
          </p>
          <p className="text-sm whitespace-pre-wrap text-card-foreground">
            {evaluation.feedback}
          </p>
        </div>
        {evaluation.should_create_flashcard && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
            {t("result.flashcard_hint")}
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              setStage("questions");
              setAnswer("");
              setEvaluation(null);
            }}
            className="px-5 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {t("result.try_another")}
          </button>
          <button
            onClick={reset}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {t("result.new_concept")}
          </button>
        </div>
      </div>
    );
  }

  // questions / answering stages share the same surface
  return (
    <div className="flex flex-col gap-5 p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t("questions.title")}</h2>
        <button
          onClick={reset}
          disabled={pending}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          {t("questions.back")}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("questions.subtitle", { concept })}
      </p>
      <div className="flex flex-col gap-2">
        {questions.map((q, i) => (
          <button
            key={i}
            onClick={() => pickQuestion(i)}
            disabled={pending}
            className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-50 ${
              i === selectedIndex
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("questions.number", { n: i + 1 })}
              </span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {tQuality(q.difficulty)}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{q.text}</p>
          </button>
        ))}
      </div>
      {selectedQuestion && (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          {selectedQuestion.hint && (
            <div>
              {showHint ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("questions.hint_prefix")} {selectedQuestion.hint}
                </p>
              ) : (
                <button
                  onClick={() => setShowHint(true)}
                  className="text-xs text-primary underline underline-offset-2"
                >
                  {t("questions.show_hint")}
                </button>
              )}
            </div>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              {t("questions.answer_label")}
            </span>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  answer.trim() &&
                  !pending
                ) {
                  e.preventDefault();
                  void evaluate();
                }
              }}
              placeholder={t("questions.answer_placeholder")}
              rows={5}
              maxLength={4000}
              disabled={pending}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </label>
          {errorKey && (
            <p className="text-sm text-destructive" role="alert">
              {t(errorKey)}
            </p>
          )}
          <button
            onClick={evaluate}
            disabled={pending || !answer.trim()}
            className="self-end px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? t("questions.evaluating") : t("questions.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
