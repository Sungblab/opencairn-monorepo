"""YAML case loader."""
from __future__ import annotations

from pathlib import Path

import yaml

from runtime.eval.case import EvalCase


def load_case_file(path: Path) -> EvalCase:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return EvalCase.model_validate(raw)


def load_cases(dir_path: str | Path) -> list[EvalCase]:
    """Load every *.yaml under dir_path recursively."""
    p = Path(dir_path)
    return [load_case_file(f) for f in sorted(p.rglob("*.yaml"))]


__all__ = ["load_case_file", "load_cases"]
