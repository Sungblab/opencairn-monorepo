"""LaTeX assemblers — output schema → .tex / .bib / zip bytes.

Templates produce the document-class preamble. The LLM emits section
content WITHOUT the preamble; we wrap it here. Korean templates require
xelatex + kotex; the Tectonic MSA uses xelatex by default.
"""
from __future__ import annotations

import io
import zipfile
from textwrap import dedent

from worker.agents.synthesis_export.schemas import (
    BibEntry,
    SynthesisOutputSchema,
)


_PREAMBLES: dict[str, str] = {
    "korean_thesis": dedent(r"""
        \documentclass[12pt]{report}
        \usepackage{kotex}
        \usepackage[a4paper,margin=1in]{geometry}
        \usepackage{graphicx}
        \usepackage{hyperref}
        \usepackage{cite}
    """).strip(),
    "ieee": r"\documentclass[conference]{IEEEtran}" + "\n\\usepackage{hyperref}\n\\usepackage{cite}",
    "acm": r"\documentclass[acmsmall]{acmart}",
    "apa": dedent(r"""
        \documentclass[a4paper,11pt]{article}
        \usepackage{apacite}
        \usepackage{hyperref}
    """).strip(),
    "report": dedent(r"""
        \documentclass[a4paper,11pt]{article}
        \usepackage[utf8]{inputenc}
        \usepackage{hyperref}
        \usepackage{cite}
    """).strip(),
}


def assemble_tex(output: SynthesisOutputSchema) -> str:
    preamble = _PREAMBLES.get(output.template, _PREAMBLES["report"])
    body_parts: list[str] = []
    for sec in output.sections:
        body_parts.append(f"\\section{{{sec.title}}}\n{sec.content}")
    abstract_block = (
        f"\\begin{{abstract}}\n{output.abstract}\n\\end{{abstract}}\n"
        if output.abstract else ""
    )
    bibliography_block = (
        "\\bibliographystyle{plain}\n\\bibliography{refs}\n"
        if output.bibliography else ""
    )

    return f"""{preamble}

\\title{{{output.title}}}
\\begin{{document}}
\\maketitle
{abstract_block}
{chr(10).join(body_parts)}

{bibliography_block}
\\end{{document}}
"""


def assemble_bib(entries: list[BibEntry]) -> str:
    out: list[str] = []
    for e in entries:
        url_line = f",\n  url = {{{e.url}}}" if e.url else ""
        year_line = f",\n  year = {{{e.year}}}" if e.year is not None else ""
        out.append(
            f"@article{{{e.cite_key},\n"
            f"  author = {{{e.author}}},\n"
            f"  title = {{{e.title}}}{year_line}{url_line},\n"
            f"  note = {{OpenCairn source: {e.source_id}}}\n"
            f"}}"
        )
    return "\n\n".join(out)


def package_zip(tex_source: str, bib_source: str | None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("main.tex", tex_source)
        if bib_source:
            zf.writestr("refs.bib", bib_source)
    return buf.getvalue()
