"""CodeAgent prompts — Plan 7 Phase 2.

Generate and fix prompts for browser-sandboxed code (Pyodide / iframe).
ADR-006 constraints baked into the system prompt.
"""
from __future__ import annotations

CODE_SYSTEM = """\
You are CodeAgent for OpenCairn — a browser-sandboxed coding assistant.

Environment constraints (ADR-006):
- Code runs in the user's browser via Pyodide (Python) or an iframe sandbox
  (JS / HTML / React via esm.sh).
- Blocking input() is NOT supported. If you need user input, hardcode it.
- Network access in Python is limited to whitelisted CDNs (cdn.jsdelivr.net,
  esm.sh). Do not assume arbitrary HTTP works.
- For matplotlib, set MPLBACKEND=Agg before importing pyplot. The runner
  collects figures via plt.get_fignums().
- For React: render with react@19 from esm.sh. Use a single default export.
- For HTML: emit a complete <!doctype html> document.
- Keep code self-contained in one file. No external file references.

Output:
- Use the emit_structured_output tool exactly once with
  {language, source, explanation}.
- explanation: one or two sentences in Korean (사용자 언어). Concise.
- source: runnable code only. No surrounding markdown fences.
"""


def _render(template: str, **fields: str) -> str:
    """Render ``template`` by replacing ``<<NAME>>`` tokens with ``fields``.

    We deliberately avoid ``str.format`` because user content frequently
    contains ``{`` / ``}`` (Python sets, JS object literals, JSX, CSS,
    template syntax, etc.). Escaping with ``{{`` / ``}}`` works but
    leaks the doubled braces into the final output (``str.format``
    only collapses braces on the template literal, not on substituted
    values), which corrupts what the LLM sees. ``str.replace`` over a
    sentinel token is the simplest interpolation that is unambiguously
    safe for arbitrary user strings.
    """
    out = template
    for name, value in fields.items():
        out = out.replace(f"<<{name}>>", value)
    return out


def build_generate_prompt(*, prompt: str, language: str) -> str:
    return _render(GENERATE_TEMPLATE, prompt=prompt, language=language)


def build_fix_prompt(
    *,
    original_prompt: str,
    language: str,
    last_code: str,
    last_error: str,
    stdout_tail: str,
) -> str:
    # Single source of truth for the "truncated to 2KB" promise in the
    # template literal below — keep the slice here so callers do not have
    # to remember.
    stdout_tail = (stdout_tail or "")[-2000:]
    if not stdout_tail:
        stdout_tail = "(empty)"
    return _render(
        FIX_TEMPLATE,
        original_prompt=original_prompt,
        language=language,
        last_code=last_code,
        last_error=last_error,
        stdout_tail=stdout_tail,
    )


GENERATE_TEMPLATE = """\
Language: <<language>>

User request:
<<prompt>>

Generate a single self-contained file that fulfils the request. Emit it via
emit_structured_output.
"""


FIX_TEMPLATE = """\
Language: <<language>>

Original user request:
<<original_prompt>>

Previous code (FAILED):
```
<<last_code>>
```

Error message:
<<last_error>>

Stdout tail (truncated to 2KB):
<<stdout_tail>>

Diagnose the failure and emit a corrected version of the file via
emit_structured_output. Keep it self-contained.
"""
