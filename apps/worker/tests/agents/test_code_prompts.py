from worker.agents.code.prompts import (
    CODE_SYSTEM,
    build_generate_prompt,
    build_fix_prompt,
)


def test_system_mentions_browser_and_no_input():
    assert "input()" in CODE_SYSTEM
    assert "browser" in CODE_SYSTEM.lower() or "pyodide" in CODE_SYSTEM.lower()
    # Lock load-bearing constraints so prompt tuning cannot silently drop them.
    assert "MPLBACKEND" in CODE_SYSTEM
    assert "esm.sh" in CODE_SYSTEM
    assert "react@19" in CODE_SYSTEM


def test_generate_prompt_embeds_user_request_and_language():
    p = build_generate_prompt(prompt="plot sin", language="python")
    assert "plot sin" in p
    assert "python" in p


def test_fix_prompt_embeds_last_code_and_error():
    p = build_fix_prompt(
        original_prompt="plot",
        language="python",
        last_code="print('hi')",
        last_error="NameError: x",
        stdout_tail="",
    )
    assert "print('hi')" in p
    assert "NameError" in p


def test_fix_prompt_truncates_stdout_tail_to_2k():
    # Use a unique sentinel character ('Z') for the leading chunk that
    # cannot collide with anything in the surrounding template, and
    # printable ASCII '~' for the trailing chunk that should survive.
    head = "Z" * 3000
    tail = "~" * 2000
    big = head + tail
    p = build_fix_prompt(
        original_prompt="p",
        language="python",
        last_code="c",
        last_error="e",
        stdout_tail=big,
    )
    assert "stdout" in p.lower()
    # The 2000-char tail must be present in full.
    assert tail in p
    # The leading chunk must have been dropped by the [-2000:] slice.
    assert "Z" not in p
    # Defensive: the original 5000-char string must not appear verbatim.
    assert big not in p


def test_fix_prompt_escapes_braces():
    # Python sets, JS object literals, JSX interpolation, etc. all use
    # braces. The interpolation must (a) not crash and (b) preserve the
    # exact bytes the user wrote — the LLM sees the prompt verbatim.
    code_with_braces = "def f(): return {1, 2}"
    p = build_fix_prompt(
        original_prompt="set",
        language="python",
        last_code=code_with_braces,
        last_error="oops",
        stdout_tail="",
    )
    assert "{1, 2}" in p
    assert "def f(): return {1, 2}" in p
    # Doubled braces would mean we leaked an escaping artifact into the
    # prompt the LLM sees.
    assert "{{1, 2}}" not in p


def test_generate_prompt_escapes_braces():
    p = build_generate_prompt(
        prompt="render <App /> with {greeting: 'hi'}",
        language="javascript",
    )
    assert "{greeting: 'hi'}" in p
    assert "{{greeting" not in p
