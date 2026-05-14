from unittest.mock import MagicMock, patch

from worker.lib.s3_client import upload_bytes


def test_upload_bytes_calls_put_object():
    with patch("worker.lib.s3_client.get_s3_client") as get_client:
        client = MagicMock()
        get_client.return_value = client
        content_type = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        key = upload_bytes("synthesis/runs/abc/doc.docx", b"data", content_type)
        client.put_object.assert_called_once()
        args, kwargs = client.put_object.call_args
        # Existing Minio call shape: bucket is arg 0, object key is arg 1.
        assert args[1] == "synthesis/runs/abc/doc.docx"
        assert key == "synthesis/runs/abc/doc.docx"
