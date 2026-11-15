import io

from fastapi.testclient import TestClient
from PIL import Image
import pytest

import app as parser


def png_bytes(size=(4, 4)) -> bytes:
    image = Image.new("RGB", size, "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_health_is_public_and_reports_tesseract(monkeypatch):
    monkeypatch.setattr(parser.pytesseract, "get_tesseract_version", lambda: "5.4")
    response = TestClient(parser.app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "doc-parser", "tesseract_available": True}


def test_parse_requires_valid_api_key(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    client = TestClient(parser.app)
    for headers in ({}, {"X-API-Key": "wrong"}):
        response = client.post("/parse", headers=headers, files={"file": ("scan.png", png_bytes(), "image/png")})
        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid or missing API key"}


def test_image_text_extraction_and_success_metadata(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: "Patient: Demo")
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("lab.PNG", png_bytes(), "image/png")}
    )
    assert response.status_code == 200
    assert response.json()["filename"] == "lab.PNG"
    assert response.json()["file_type"] == "png"
    assert response.json()["page_count"] == 1
    assert response.json()["ocr_pages_used"] == []
    assert response.json()["text"] == "Patient: Demo"
    assert response.json()["processing_time_ms"] >= 0


def test_unsupported_extension_and_oversized_file_are_rejected(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    client = TestClient(parser.app)
    headers = {"X-API-Key": "a" * 32}
    unsupported = client.post("/parse", headers=headers, files={"file": ("notes.txt", b"plain text", "text/plain")})
    assert unsupported.status_code == 415
    assert unsupported.json() == {"detail": "Unsupported file type"}
    large = client.post("/parse", headers=headers, files={"file": ("large.png", b"x" * (25 * 1024 * 1024 + 1), "image/png")})
    assert large.status_code == 413
    assert large.json() == {"detail": "File exceeds 25MB limit"}


def test_scanned_pdf_page_uses_ocr_and_returns_page_number(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)

    class Page:
        def extract_text(self):
            return "  "

    class Reader:
        is_encrypted = False
        pages = [Page()]

    monkeypatch.setattr(parser, "PdfReader", lambda path, strict=False: Reader())
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: [Image.new("RGB", (2, 2), "white")])
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: "OCR result")
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("scan.pdf", b"synthetic PDF", "application/pdf")}
    )
    assert response.status_code == 200
    assert response.json()["page_count"] == 1
    assert response.json()["ocr_pages_used"] == [1]
    assert response.json()["text"] == "OCR result"


def test_pdf_page_count_limit_is_checked_before_rendering(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)

    class Reader:
        is_encrypted = False
        pages = [object()] * (parser.MAX_PDF_PAGES + 1)

    monkeypatch.setattr(parser, "PdfReader", lambda path, strict=False: Reader())
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: pytest.fail("PDF should not be rendered"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("long.pdf", b"synthetic PDF", "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": f"PDF exceeds the {parser.MAX_PDF_PAGES}-page processing limit"}


def test_pdf_ocr_work_limit_stops_before_rendering_another_page(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)

    class Page:
        def extract_text(self):
            return ""

    class Reader:
        is_encrypted = False
        pages = [Page() for _ in range(parser.MAX_OCR_PAGES + 1)]

    rendered_pages = []
    monkeypatch.setattr(parser, "PdfReader", lambda path, strict=False: Reader())
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: rendered_pages.append(kwargs["first_page"]) or [Image.new("RGB", (2, 2), "white")])
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: "OCR")
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("scans.pdf", b"synthetic PDF", "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": f"PDF exceeds the {parser.MAX_OCR_PAGES}-page OCR limit"}
    assert rendered_pages == list(range(1, parser.MAX_OCR_PAGES + 1))


def test_corrupt_document_is_422_and_temp_upload_is_removed(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    original_tempfile = parser.tempfile.NamedTemporaryFile

    def temporary_upload(*args, **kwargs):
        kwargs["dir"] = tmp_path
        return original_tempfile(*args, **kwargs)

    monkeypatch.setattr(parser.tempfile, "NamedTemporaryFile", temporary_upload)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("broken.png", b"not an image", "image/png")}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unable to parse document"}
    assert list(tmp_path.iterdir()) == []
