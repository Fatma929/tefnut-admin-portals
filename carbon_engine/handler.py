"""
AWS Lambda handler for the Tefnut Carbon Engine.

Supported routes (via API Gateway):
  POST /api/calculate          — JSON body matching PlantInput
  POST /api/calculate/upload   — multipart/form-data OR base64-encoded file body

File upload detection:
  - If Content-Type contains 'multipart/form-data', the file is extracted from
    the first part whose name is 'file'.
  - If Content-Type is 'application/octet-stream' or 'text/csv', the raw body
    is treated as the file. The filename must be passed in the
    X-Filename header (e.g. "plant_data.xlsx").
  - If the body is a base64-encoded string (isBase64Encoded=True in the event),
    it is decoded automatically by API Gateway before reaching this handler.
"""

from __future__ import annotations

import base64
import cgi
import io
import json
import logging
from typing import Any

from pydantic import ValidationError

from carbon_engine import CarbonEngine, PlantInput
from carbon_engine.parser import TemplateParseError, parse_file

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------
_CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
}


def _ok(body: Any) -> dict:
    return {
        "statusCode": 200,
        "headers": _CORS_HEADERS,
        "body": body if isinstance(body, str) else json.dumps(body),
    }


def _err(status: int, message: str, detail: Any = None) -> dict:
    payload: dict = {"error": message}
    if detail is not None:
        payload["detail"] = detail
    return {
        "statusCode": status,
        "headers": _CORS_HEADERS,
        "body": json.dumps(payload),
    }


# ---------------------------------------------------------------------------
# Route: POST /api/calculate  (JSON body)
# ---------------------------------------------------------------------------
def _handle_json(event: dict) -> dict:
    body = event.get("body", "{}")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError as exc:
            return _err(400, "Invalid JSON body", str(exc))

    try:
        plant_input = PlantInput.model_validate(body)
    except ValidationError as exc:
        logger.warning("JSON validation error: %s", exc)
        return _err(422, "Validation failed", exc.errors())

    result = CarbonEngine(plant_input).calculate()
    return _ok(result.model_dump_json())


# ---------------------------------------------------------------------------
# Route: POST /api/calculate/upload  (file upload)
# ---------------------------------------------------------------------------
def _extract_file_from_multipart(
    body_bytes: bytes, content_type: str
) -> tuple[bytes, str]:
    """
    Extract the first file part from a multipart/form-data body.
    Returns (file_bytes, filename).
    """
    # cgi.FieldStorage needs a file-like object and environ dict
    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_TYPE": content_type,
        "CONTENT_LENGTH": str(len(body_bytes)),
    }
    fs = cgi.FieldStorage(
        fp=io.BytesIO(body_bytes),
        environ=environ,
        keep_blank_values=True,
    )

    # Look for a field named 'file'
    if "file" in fs:
        field = fs["file"]
        return field.file.read(), field.filename or "upload.xlsx"

    # Fallback: take the first field that has a filename
    for key in fs.keys():
        field = fs[key]
        if hasattr(field, "filename") and field.filename:
            return field.file.read(), field.filename

    raise ValueError("No file part found in multipart body. Use field name 'file'.")


def _handle_upload(event: dict) -> dict:
    content_type: str = ""
    for header_key, header_val in (event.get("headers") or {}).items():
        if header_key.lower() == "content-type":
            content_type = header_val
            break

    # Decode body
    raw_body = event.get("body", "")
    is_b64 = event.get("isBase64Encoded", False)

    if isinstance(raw_body, str):
        body_bytes = base64.b64decode(raw_body) if is_b64 else raw_body.encode()
    else:
        body_bytes = raw_body

    # Determine filename
    filename = "upload.xlsx"
    for header_key, header_val in (event.get("headers") or {}).items():
        if header_key.lower() == "x-filename":
            filename = header_val
            break

    # Extract file bytes
    try:
        if "multipart/form-data" in content_type:
            file_bytes, filename = _extract_file_from_multipart(body_bytes, content_type)
        else:
            # Raw binary upload — body IS the file
            file_bytes = body_bytes
    except Exception as exc:
        return _err(400, "Could not extract file from request", str(exc))

    if not file_bytes:
        return _err(400, "Uploaded file is empty")

    logger.info("Processing upload: filename=%s size=%d bytes", filename, len(file_bytes))

    # Parse file → PlantInput
    try:
        plant_input = parse_file(file_bytes, filename)
    except TemplateParseError as exc:
        logger.warning("Template parse error: %s", exc)
        return _err(422, "Template parse failed", [e.to_dict() for e in exc.errors])
    except Exception as exc:
        logger.exception("Unexpected parse error: %s", exc)
        return _err(500, "File parsing failed", str(exc))

    # Run calculation
    try:
        result = CarbonEngine(plant_input).calculate()
    except Exception as exc:
        logger.exception("Calculation error: %s", exc)
        return _err(500, "Calculation failed", str(exc))

    # Return result + echo back the parsed input for transparency
    response_body = {
        "result": json.loads(result.model_dump_json()),
        "parsed_input": json.loads(plant_input.model_dump_json()),
    }
    return _ok(response_body)


# ---------------------------------------------------------------------------
# Main Lambda entry point
# ---------------------------------------------------------------------------
def lambda_handler(event: dict, context: object) -> dict:
    """
    Routes:
      POST /api/calculate          → JSON body
      POST /api/calculate/upload   → file upload
    """
    try:
        path: str = event.get("path", "") or event.get("rawPath", "")
        logger.info("Request path: %s", path)

        if path.rstrip("/").endswith("upload"):
            return _handle_upload(event)

        return _handle_json(event)

    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return _err(500, "Internal server error")
