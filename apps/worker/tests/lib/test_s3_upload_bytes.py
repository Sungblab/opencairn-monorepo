from unittest.mock import patch, MagicMock
from worker.lib.s3_client import upload_bytes


def test_upload_bytes_calls_put_object():
    with patch("worker.lib.s3_client.get_s3_client") as get_client:
        client = MagicMock()
        get_client.return_value = client
        key = upload_bytes("synthesis/runs/abc/doc.docx", b"data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        client.put_object.assert_called_once()
        args, kwargs = client.put_object.call_args
        # `bucket` is positional arg [0], object_key is [1] (per existing s3_client.py Minio API usage)
        assert args[1] == "synthesis/runs/abc/doc.docx"
        assert key == "synthesis/runs/abc/doc.docx"
