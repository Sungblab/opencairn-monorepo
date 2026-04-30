import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SocraticSession } from "./SocraticSession";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, unknown>) =>
    vars
      ? `${ns ? `${ns}.` : ""}${k}(${JSON.stringify(vars)})`
      : ns
        ? `${ns}.${k}`
        : k,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("<SocraticSession>", () => {
  it("renders the empty-state guide and concept input on first load", () => {
    render(<SocraticSession projectId="proj-1" />);
    expect(
      screen.getByText("learn.socratic.input.empty_guide"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("learn.socratic.input.concept_placeholder"),
    ).toBeInTheDocument();
  });

  it("disables the generate button until a concept is typed", () => {
    render(<SocraticSession projectId="proj-1" />);
    const button = screen.getByRole("button", {
      name: "learn.socratic.input.generate",
    });
    expect(button).toBeDisabled();
    fireEvent.change(
      screen.getByPlaceholderText("learn.socratic.input.concept_placeholder"),
      { target: { value: "Bayesian inference" } },
    );
    expect(button).not.toBeDisabled();
  });

  it("calls /api/projects/:id/socratic/generate and renders questions", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        questions: [
          { text: "What is the prior?", hint: null, difficulty: "easy" },
          { text: "Explain Bayes' rule.", hint: "Use a tree.", difficulty: "medium" },
        ],
      }),
    );
    render(<SocraticSession projectId="proj-1" initialConcept="Bayes" />);
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.input.generate" }),
    );
    await waitFor(() => {
      expect(screen.getByText("What is the prior?")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj-1/socratic/generate",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({ conceptName: "Bayes", noteContext: "" });
  });

  it("surfaces a friendly error when generate returns 403", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "forbidden" }, { status: 403 }),
    );
    render(<SocraticSession projectId="proj-1" initialConcept="Bayes" />);
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.input.generate" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("learn.socratic.errors.forbidden"),
      ).toBeInTheDocument();
    });
  });

  it("evaluates the selected question and renders the score + feedback", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          questions: [
            { text: "Q1", hint: null, difficulty: "easy" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          score: 92,
          is_correct: true,
          feedback: "Strong reasoning.",
          should_create_flashcard: false,
        }),
      );
    render(<SocraticSession projectId="proj-1" initialConcept="Bayes" />);
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.input.generate" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Q1")).toBeInTheDocument();
    });
    fireEvent.change(
      screen.getByPlaceholderText("learn.socratic.questions.answer_placeholder"),
      { target: { value: "The prior is the marginal." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.questions.submit" }),
    );
    await waitFor(() => {
      expect(screen.getByText("92")).toBeInTheDocument();
    });
    expect(screen.getByText("Strong reasoning.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/proj-1/socratic/evaluate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the flashcard hint when evaluator recommends it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          questions: [{ text: "Q1", hint: null, difficulty: "easy" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          score: 35,
          is_correct: false,
          feedback: "Review the basics.",
          should_create_flashcard: true,
        }),
      );
    render(<SocraticSession projectId="proj-1" initialConcept="Bayes" />);
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.input.generate" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Q1")).toBeInTheDocument();
    });
    fireEvent.change(
      screen.getByPlaceholderText("learn.socratic.questions.answer_placeholder"),
      { target: { value: "I'm not sure." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.questions.submit" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("learn.socratic.result.flashcard_hint"),
      ).toBeInTheDocument();
    });
  });

  it("does not render the empty-questions array as a session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ questions: [] }));
    render(<SocraticSession projectId="proj-1" initialConcept="Bayes" />);
    fireEvent.click(
      screen.getByRole("button", { name: "learn.socratic.input.generate" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("learn.socratic.errors.no_questions"),
      ).toBeInTheDocument();
    });
    // Stays on the input stage
    expect(
      screen.getByPlaceholderText("learn.socratic.input.concept_placeholder"),
    ).toBeInTheDocument();
  });
});
