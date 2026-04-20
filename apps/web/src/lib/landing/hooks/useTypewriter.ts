"use client";
import { useEffect, useState } from "react";

export function useTypewriter(words: string[], speed = 80, pause = 1400) {
  const [text, setText] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  useEffect(() => {
    if (!words.length) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(words[0]);
      return;
    }
    const current = words[wordIdx];
    if (dir === "fwd" && charIdx < current.length) {
      const t = setTimeout(() => setCharIdx((c) => c + 1), speed);
      setText(current.slice(0, charIdx + 1));
      return () => clearTimeout(t);
    }
    if (dir === "fwd" && charIdx === current.length) {
      const t = setTimeout(() => setDir("back"), pause);
      return () => clearTimeout(t);
    }
    if (dir === "back" && charIdx > 0) {
      const t = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
      setText(current.slice(0, charIdx - 1));
      return () => clearTimeout(t);
    }
    if (dir === "back" && charIdx === 0) {
      setDir("fwd");
      setWordIdx((i) => (i + 1) % words.length);
    }
  }, [wordIdx, charIdx, dir, words, speed, pause]);

  return text;
}
