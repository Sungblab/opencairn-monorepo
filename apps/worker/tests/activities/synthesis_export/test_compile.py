import os
from unittest.mock import AsyncMock, call, patch

import pytest
from temporalio.testing import ActivityEnvironment

from worker.activities.synthesis_export.compile import compile_activity
from worker.activities.synthesis_export.types import SynthesisRunParams
from worker.agents.synthesis_export.schemas import (
    SynthesisOutputSchema,
    SynthesisSection,
)


def _output(fmt="md"):
    return SynthesisOutputSchema(
        format=fmt,
        title="T",
        abstract=None,
        sections=[SynthesisSection(title="S", content="c", source_ids=[])],
        bibliography=[],
        template="report",
    )


def _params(fmt="md"):
    return SynthesisRunParams(
        run_id="r1",
        workspace_id="w1",
        project_id=None,
        user_id="u1",
        format=fmt,
        template="report",
        user_prompt="x",
        explicit_source_ids=[],
        note_ids=[],
        auto_search=False,
        byok_key_handle=None,
    )


@pytest.mark.asyncio
async def test_compile_md_uploads_directly():
    with (
        patch(
            "worker.activities.synthesis_export.compile.set_status",
            new=AsyncMock(),
        ) as flip,
        patch(
            "worker.activities.synthesis_export.compile.upload_bytes",
            return_value="synthesis/runs/r1/doc.md",
        ) as up,
        patch(
            "worker.activities.synthesis_export.compile._record_document",
            new=AsyncMock(),
        ),
    ):
        env = ActivityEnvironment()
        artifact = await env.run(compile_activity, _params("md"), _output("md"))
        assert artifact.s3_key.endswith(".md")
        up.assert_called_once()
        assert flip.await_args_list[-1] == call("r1", "completed"), (
            "compile branch did not flip 'completed' last; "
            f"got: {flip.await_args_list}"
        )


@pytest.mark.asyncio
async def test_compile_latex_without_pro_returns_zip():
    os.environ["FEATURE_TECTONIC_COMPILE"] = "false"
    with (
        patch(
            "worker.activities.synthesis_export.compile.set_status",
            new=AsyncMock(),
        ) as flip,
        patch(
            "worker.activities.synthesis_export.compile.upload_bytes",
            return_value="synthesis/runs/r1/doc.zip",
        ) as up,
        patch(
            "worker.activities.synthesis_export.compile._record_document",
            new=AsyncMock(),
        ),
    ):
        env = ActivityEnvironment()
        artifact = await env.run(compile_activity, _params("latex"), _output("latex"))
        assert artifact.format == "zip"
        up.assert_called_once()
        assert flip.await_args_list[-1] == call("r1", "completed"), (
            "compile branch did not flip 'completed' last; "
            f"got: {flip.await_args_list}"
        )


@pytest.mark.asyncio
async def test_compile_docx_routes_to_internal_api():
    with (
        patch(
            "worker.activities.synthesis_export.compile.set_status",
            new=AsyncMock(),
        ) as flip,
        patch(
            "worker.activities.synthesis_export.compile.post_internal",
            new=AsyncMock(
                return_value={"s3Key": "synthesis/runs/r1/doc.docx", "bytes": 1024}
            ),
        ) as post,
        patch(
            "worker.activities.synthesis_export.compile._record_document",
            new=AsyncMock(),
        ),
    ):
        env = ActivityEnvironment()
        artifact = await env.run(compile_activity, _params("docx"), _output("docx"))
        assert artifact.s3_key.endswith(".docx")
        post.assert_awaited_once()
        assert post.await_args.args[0] == "/api/internal/synthesis-export/compile"
        assert flip.await_args_list[-1] == call("r1", "completed"), (
            "compile branch did not flip 'completed' last; "
            f"got: {flip.await_args_list}"
        )


@pytest.mark.asyncio
async def test_compile_md_flips_compiling_then_completed():
    with (
        patch(
            "worker.activities.synthesis_export.compile.set_status",
            new=AsyncMock(),
        ) as flip,
        patch(
            "worker.activities.synthesis_export.compile.upload_bytes",
            return_value="synthesis/runs/r1/doc.md",
        ),
        patch(
            "worker.activities.synthesis_export.compile._record_document",
            new=AsyncMock(),
        ),
    ):
        env = ActivityEnvironment()
        await env.run(compile_activity, _params("md"), _output("md"))
        assert flip.await_args_list == [
            call("r1", "compiling"),
            call("r1", "completed"),
        ]


@pytest.mark.asyncio
async def test_post_tectonic_returns_pdf_bytes(httpx_mock):
    pdf_body = b"%PDF-1.4\nfake pdf"
    httpx_mock.add_response(
        method="POST",
        url="http://tectonic:8888/compile",
        content=pdf_body,
        headers={"Content-Type": "application/pdf"},
    )
    from worker.activities.synthesis_export.compile import _post_tectonic

    tex_source = r"\documentclass{article}\begin{document}x\end{document}"
    out = await _post_tectonic(tex_source, "")
    assert out == pdf_body


@pytest.mark.asyncio
async def test_post_tectonic_504_raises_timeout(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://tectonic:8888/compile",
        status_code=504,
        json={"detail": "compile timeout"},
    )
    from worker.activities.synthesis_export.compile import _post_tectonic
    with pytest.raises(RuntimeError, match="tectonic_timeout"):
        await _post_tectonic("\\doc{}", "")


@pytest.mark.asyncio
async def test_post_tectonic_400_raises_failed(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://tectonic:8888/compile",
        status_code=400,
        json={"detail": {"error": "compile_failed", "log": "boom"}},
    )
    from worker.activities.synthesis_export.compile import _post_tectonic
    with pytest.raises(RuntimeError, match="tectonic_failed"):
        await _post_tectonic("\\doc{}", "")
