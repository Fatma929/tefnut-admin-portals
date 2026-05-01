"""
AWS Lambda handler for the Tefnut Water Engine.

Supported routes (via API Gateway):
  POST /api/water/upload   — multipart/form-data OR base64-encoded file body

Response envelope (all routes):
  { "result": <WaterResult | null>, "validation": { "status", "errors", "warnings" } }

File upload detection:
  - If Content-Type contains 'multipart/form-data', the file is extracted from
    the first part whose name is 'file'.
  - Otherwise the raw body is treated as the file. The filename must be passed
    in the X-Filename header (e.g. "water_data.xlsx").
  - If the body is a base64-encoded string (isBase64Encoded=True in the event),
    it is decoded automatically by API Gateway before reaching this handler.

Request headers consumed:
  X-Filename        — original filename for upload audit trail
  X-Timestamp-Utc   — ISO-8601 UTC timestamp of the upload (injected by proxy)
  X-User-Id         — authenticated user ID (injected by proxy)

Column mapping (Excel/CSV → WaterInput):
  Withdrawal:  surface_water, groundwater, quarry_water_used,
               municipal_potable_water, external_wastewater, harvested_rainwater
  Discharge:   ocean, discharge_surface_water, subsurface_well,
               offsite_water_treatment, beneficial_other_users
  Ancillary:   quarry_water_not_used_m3_yr, recycled_water_m3_yr,
               storm_water_collected_discharged_m3_yr, cementitious_production_t_yr
"""

from __future__ import annotations

import base64
import cgi
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

from water_engine.water_engine import (
    AuditContext,
    WaterDischarge,
    WaterEngine,
    WaterInput,
    WaterWithdrawal,
)
from carbon_engine.validation import ValidationResult, WarningDetail

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


def _engine_response(result_dict: dict | None, validation: ValidationResult) -> dict:
    """Build the unified EngineResponse envelope consumed by the frontend."""
    return {
        "result": result_dict,
        "validation": validation.to_response_dict(),
    }


def _extract_header(event: dict, name: str) -> str | None:
    """Case-insensitive header lookup from a Lambda event dict."""
    for k, v in (event.get("headers") or {}).items():
        if k.lower() == name.lower():
            return v
    return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# File parsing
# ---------------------------------------------------------------------------
def _parse_water_input_from_file(
    file_bytes: bytes, filename: str
) -> tuple[dict, WaterInput]:
    """
    Parse an Excel or CSV file into a (raw_dict, WaterInput) pair.

    raw_dict is passed to WaterEngine.validate_input() so the full validation
    pipeline runs on the original data before the typed model is constructed.
    """
    import io as _io

    import pandas as pd

    buf = _io.BytesIO(file_bytes)
    if filename.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(buf)
    else:
        df = pd.read_csv(buf)

    row = df.iloc[0].to_dict()

    def g(k: str, default: float = 0.0) -> float:
        val = row.get(k, default)
        if val is None or (isinstance(val, float) and __import__("math").isnan(val)):
            return default
        return float(val)

    raw_dict: dict = {
        "withdrawal": {
            "surface_water": g("surface_water"),
            "groundwater": g("groundwater"),
            "quarry_water_used": g("quarry_water_used"),
            "municipal_potable_water": g("municipal_potable_water"),
            "external_wastewater": g("external_wastewater"),
            "harvested_rainwater": g("harvested_rainwater"),
        },
        "discharge": {
            "ocean": g("ocean"),
            "surface_water": g("discharge_surface_water"),
            "subsurface_well": g("subsurface_well"),
            "offsite_water_treatment": g("offsite_water_treatment"),
            "beneficial_other_users": g("beneficial_other_users"),
        },
        "quarry_water_not_used_m3_yr": g("quarry_water_not_used_m3_yr"),
        "recycled_water_m3_yr": g("recycled_water_m3_yr"),
        "storm_water_collected_discharged_m3_yr": g("storm_water_collected_discharged_m3_yr"),
        "cementitious_production_t_yr": g("cementitious_production_t_yr", 1.0),
    }

    water_input = WaterInput(
        withdrawal=WaterWithdrawal(**raw_dict["withdrawal"]),
        discharge=WaterDischarge(**raw_dict["discharge"]),
        quarry_water_not_used_m3_yr=raw_dict["quarry_water_not_used_m3_yr"],
        recycled_water_m3_yr=raw_dict["recycled_water_m3_yr"],
        storm_water_collected_discharged_m3_yr=raw_dict["storm_water_collected_discharged_m3_yr"],
        cementitious_production_t_yr=raw_dict["cementitious_production_t_yr"],
    )
    return raw_dict, water_input


# ---------------------------------------------------------------------------
# Route: POST /api/water/upload  (file upload)
# ---------------------------------------------------------------------------
def _extract_file_from_multipart(
    body_bytes: bytes, content_type: str
) -> tuple[bytes, str]:
    """
    Extract the first file part from a multipart/form-data body.
    Returns (file_bytes, filename).
    """
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

    if "file" in fs:
        field = fs["file"]
        return field.file.read(), field.filename or "upload.xlsx"

    for key in fs.keys():
        field = fs[key]
        if hasattr(field, "filename") and field.filename:
            return field.file.read(), field.filename

    raise ValueError("No file part found in multipart body. Use field name 'file'.")


def _handle_upload(event: dict) -> dict:
    content_type = _extract_header(event, "content-type") or ""
    filename = _extract_header(event, "x-filename") or "upload.xlsx"
    timestamp_utc = _extract_header(event, "x-timestamp-utc") or _utc_now()
    user_id = _extract_header(event, "x-user-id") or "anonymous"

    # Decode body
    raw_body = event.get("body", "")
    is_b64 = event.get("isBase64Encoded", False)

    if isinstance(raw_body, str):
        body_bytes = base64.b64decode(raw_body) if is_b64 else raw_body.encode()
    else:
        body_bytes = raw_body

    # Extract file bytes
    try:
        if "multipart/form-data" in content_type:
            file_bytes, filename = _extract_file_from_multipart(body_bytes, content_type)
        else:
            file_bytes = body_bytes
    except Exception as exc:
        return _err(400, "Could not extract file from request", str(exc))

    if not file_bytes:
        return _err(400, "Uploaded file is empty")

    logger.info(
        "Processing water upload: filename=%s size=%d bytes user=%s",
        filename,
        len(file_bytes),
        user_id,
    )

    # Parse file → (raw_dict, WaterInput)
    try:
        raw_dict, water_input = _parse_water_input_from_file(file_bytes, filename)
    except Exception as exc:
        logger.exception("File parse error: %s", exc)
        return _err(422, "File parsing failed", str(exc))

    # 1. Pre-calculation validation
    validation = WaterEngine.validate_input(raw_dict, timestamp_utc)
    if validation.is_blocked:
        logger.warning("Water upload validation blocked: %d errors", len(validation.errors))
        return _ok(_engine_response(None, validation))

    # 2. Build AuditContext and run calculation
    audit_ctx = AuditContext(
        source_filename=filename,
        upload_timestamp_utc=timestamp_utc,
        user_id=user_id,
    )
    try:
        result = WaterEngine(water_input, audit_ctx).calculate()
    except Exception as exc:
        logger.exception("Water calculation error: %s", exc)
        return _err(500, "Calculation failed", str(exc))

    # 3. Merge post-calc warnings into the validation envelope
    for w in result.validation_warnings:
        if isinstance(w, dict):
            validation.warnings.append(WarningDetail(**w))
        else:
            validation.warnings.append(w)

    return _ok(_engine_response(json.loads(result.model_dump_json()), validation))


# ---------------------------------------------------------------------------
# Main Lambda entry point
# ---------------------------------------------------------------------------
def lambda_handler(event: dict, context: object) -> dict:
    """
    Entry point for the Water Engine Lambda function.
    All requests are routed to _handle_upload regardless of path.
    """
    try:
        path: str = event.get("path", "") or event.get("rawPath", "")
        logger.info("Water handler request path: %s", path)
        return _handle_upload(event)
    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return _err(500, "Internal server error")
