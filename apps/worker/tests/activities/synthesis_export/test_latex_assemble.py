from worker.activities.synthesis_export.latex_assemble import (
    assemble_bib,
    assemble_tex,
    package_zip,
)
from worker.agents.synthesis_export.schemas import (
    BibEntry,
    SynthesisOutputSchema,
    SynthesisSection,
)


def _output(template="ieee"):
    return SynthesisOutputSchema(
        format="latex",
        title="T",
        abstract="abs",
        sections=[
            SynthesisSection(
                title="Intro",
                content="Body \\cite{src:a3f2b1c9}",
                source_ids=["a3f2b1c9"],
            )
        ],
        bibliography=[
            BibEntry(
                cite_key="src:a3f2b1c9",
                author="Doe",
                title="Paper",
                year=2024,
                url="https://x",
                source_id="a3f2b1c9",
            )
        ],
        template=template,
    )


def test_assemble_tex_includes_korean_packages_for_korean_thesis():
    tex = assemble_tex(_output(template="korean_thesis"))
    assert "\\documentclass" in tex
    assert "kotex" in tex
    assert "\\section{Intro}" in tex
    assert "\\cite{src:a3f2b1c9}" in tex
    assert "\\bibliography" in tex


def test_assemble_tex_uses_ieeetran_for_ieee():
    tex = assemble_tex(_output(template="ieee"))
    assert "IEEEtran" in tex


def test_assemble_bib_emits_article_entry():
    bib = assemble_bib(
        [
            BibEntry(
                cite_key="src:a3f2b1c9",
                author="Doe",
                title="P",
                year=2024,
                url=None,
                source_id="a3f2b1c9",
            )
        ]
    )
    assert "@article{src:a3f2b1c9" in bib
    assert "author = {Doe}" in bib


def test_package_zip_contains_main_tex_and_bib():
    import io
    import zipfile
    z_bytes = package_zip("\\documentclass{article}", "@article{x}")
    zf = zipfile.ZipFile(io.BytesIO(z_bytes))
    names = zf.namelist()
    assert "main.tex" in names
    assert "refs.bib" in names
