import os
import pytest
from unittest.mock import AsyncMock, call, patch
from temporalio.testing import ActivityEnvironment
from worker.activities.synthesis_export.compile import compile_activity
from worker.activities.synthesis_export.types import SynthesisRunParams
from worker.agents.synthesis_export.schemas import SynthesisOutputSchema, SynthesisSection


def _output(fmt="md"):
    return SynthesisOutputSchema(
        format=fmt, title="T", abstract=None,
        sections=[SynthesisSection(title="S", content="c", source_ids=[])],
        bibliography=[], template="report",
    )


def _params(fmt="md"):
    return SynthesisRunParams(
        run_id="r1", workspace_id="w1", project_id=None, user_id="u1",
        format=fmt, template="report", user_prompt="x",
        explicit_source_ids=[], note_ids=[], auto_search=False, byok_key_handle=None,
    )


@pytest.mark.asyncio
async def test_compile_md_uploads_directly():
    with patch("worker.activities.synthesis_export.compile.set_status", new=AsyncMock()) as flip, \
         patch("worker.activities.synthesis_export.compile.upload_bytes", return_value="synthesis/runs/r1/doc.md") as up:
        with patch("worker.activities.synthesis_export.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("md"), _output("md"))
            assert artifact.s3_key.endswith(".md")
            up.assert_called_once()
            assert flip.await_args_list[-1] == call("r1", "completed"), (
                f"compile branch did not flip 'completed' last; got: {flip.await_args_list}"
            )


@pytest.mark.asyncio
async def test_compile_latex_without_pro_returns_zip():
    os.environ["FEATURE_TECTONIC_COMPILE"] = "false"
    with patch("worker.activities.synthesis_export.compile.set_status", new=AsyncMock()) as flip, \
         patch("worker.activities.synthesis_export.compile.upload_bytes", return_value="synthesis/runs/r1/doc.zip") as up:
        with patch("worker.activities.synthesis_export.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("latex"), _output("latex"))
            assert artifact.format == "zip"
            up.assert_called_once()
            assert flip.await_args_list[-1] == call("r1", "completed"), (
                f"compile branch did not flip 'completed' last; got: {flip.await_args_list}"
            )


@pytest.mark.asyncio
async def test_compile_docx_routes_to_internal_api():
    with patch("worker.activities.synthesis_export.compile.set_status", new=AsyncMock()) as flip, \
         patch("worker.activities.synthesis_export.compile.post_internal",
               new=AsyncMock(return_value={"s3Key": "synthesis/runs/r1/doc.docx", "bytes": 1024})) as post:
        with patch("worker.activities.synthesis_export.compile._record_document", new=AsyncMock()):
            env = ActivityEnvironment()
            artifact = await env.run(compile_activity, _params("docx"), _output("docx"))
            assert artifact.s3_key.endswith(".docx")
            post.assert_awaited_once()
            assert post.await_args.args[0] == "/api/internal/synthesis-export/compile"
            assert flip.await_args_list[-1] == call("r1", "completed"), (
                f"compile branch did not flip 'completed' last; got: {flip.await_args_list}"
            )


@pytest.mark.asyncio
async def test_compile_md_flips_compiling_then_completed():
    with patch("worker.activities.synthesis_export.compile.set_status", new=AsyncMock()) as flip, \
         patch("worker.activities.synthesis_export.compile.upload_bytes", return_value="synthesis/runs/r1/doc.md"), \
         patch("worker.activities.synthesis_export.compile._record_document", new=AsyncMock()):
        env = ActivityEnvironment()
        await env.run(compile_activity, _params("md"), _output("md"))
        assert flip.await_args_list == [call("r1", "compiling"), call("r1", "completed")]
