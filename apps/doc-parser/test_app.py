import io
import os
import shutil

from fastapi.testclient import TestClient
from PIL import Image, WebPImagePlugin
from pypdf import PageObject, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject, NumberObject, TextStringObject
import pytest

import app as parser


def png_bytes(size=(4, 4)) -> bytes:
    image = Image.new("RGB", size, "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def webp_bytes(variant) -> bytes:
    buffer = io.BytesIO()
    with Image.new("RGB", (5, 4), "white") as image:
        options = {"lossless": variant == "lossless"}
        if variant == "extended":
            options["exif"] = b"Exif\0\0synthetic"
        image.save(buffer, format="WEBP", **options)
    upload = buffer.getvalue()
    assert upload[12:16] == {"lossy": b"VP8 ", "lossless": b"VP8L", "extended": b"VP8X"}[variant]
    return upload


def pdf_bytes(width=612, height=792, user_unit=1, rotation=0) -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)

    def pdf_number(value):
        return TextStringObject(value) if isinstance(value, str) else FloatObject(value)

    page[NameObject("/MediaBox")] = ArrayObject([
        NumberObject(0), NumberObject(0), pdf_number(width), pdf_number(height),
    ])
    page[NameObject("/UserUnit")] = pdf_number(user_unit)
    page[NameObject("/Rotate")] = NumberObject(rotation)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def digital_pdf_bytes(pages: list[str]) -> bytes:
    writer = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    for text in pages:
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = DecodedStreamObject()
        stream.set_data(f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_health_is_public_and_reports_tesseract(monkeypatch):
    monkeypatch.setattr(parser.pytesseract, "get_tesseract_version", lambda: "5.4")
    response = TestClient(parser.app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "doc-parser", "tesseract_available": True}


def test_health_reports_unavailable_when_tesseract_check_fails(monkeypatch):
    def fail():
        raise RuntimeError("tesseract missing")

    monkeypatch.setattr(parser.pytesseract, "get_tesseract_version", fail)
    response = TestClient(parser.app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "doc-parser", "tesseract_available": False}


def test_digital_pdf_extracts_text_without_ocr(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: pytest.fail("Digital PDF must not render"))
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: pytest.fail("Digital PDF must not run OCR"))
    payload = digital_pdf_bytes(["Page one clinical summary", "Page two lab interpretation"])
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("report.pdf", payload, "application/pdf")}
    )
    assert response.status_code == 200
    assert response.json()["file_type"] == "pdf"
    assert response.json()["page_count"] == 2
    assert response.json()["ocr_pages_used"] == []
    assert response.json()["text"] == "Page one clinical summary\n\nPage two lab interpretation"


def test_upload_filename_strips_directory_traversal(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: "Sanitized")
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("../../etc/passwd.png", png_bytes(), "image/png")}
    )
    assert response.status_code == 200
    assert response.json()["filename"] == "passwd.png"


@pytest.mark.parametrize("kind", ["encrypted", "empty"])
def test_encrypted_and_empty_pdfs_return_422_and_cleanup_temp_upload(monkeypatch, tmp_path, kind):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    original_tempfile = parser.tempfile.NamedTemporaryFile

    def temporary_upload(*args, **kwargs):
        kwargs["dir"] = tmp_path
        return original_tempfile(*args, **kwargs)

    monkeypatch.setattr(parser.tempfile, "NamedTemporaryFile", temporary_upload)
    writer = PdfWriter()
    if kind == "encrypted":
        writer.add_blank_page(width=612, height=792)
        writer.encrypt("secret")
    buffer = io.BytesIO()
    writer.write(buffer)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": (f"{kind}.pdf", buffer.getvalue(), "application/pdf")}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unable to parse document"}
    assert list(tmp_path.iterdir()) == []


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
        mediabox = PageObject.create_blank_page(width=612, height=792).mediabox
        user_unit = 1

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
        mediabox = PageObject.create_blank_page(width=612, height=792).mediabox
        user_unit = 1

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


@pytest.mark.parametrize("size", [(4, 4), (5, 4), (4, 5), (5, 1)])
def test_images_within_pixel_and_dimension_limits_remain_readable(monkeypatch, size):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "MAX_IMAGE_PIXELS", 20, raising=False)
    monkeypatch.setattr(parser, "MAX_IMAGE_DIMENSION", 5, raising=False)
    recognized_sizes = []

    def recognize(image):
        recognized_sizes.append(image.size)
        assert image.getpixel((0, 0)) == (255, 255, 255)
        return "Boundary scan text"

    monkeypatch.setattr(parser.pytesseract, "image_to_string", recognize)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.png", png_bytes(size), "image/png")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Boundary scan text"
    assert recognized_sizes == [size]


@pytest.mark.parametrize("size,pixel_limit,dimension_limit", [
    ((5, 4), 19, 10),
    ((6, 1), 100, 5),
    ((1, 6), 100, 5),
])
def test_oversized_image_headers_rejected_before_loading_or_ocr_and_upload_removed(
    monkeypatch, tmp_path, size, pixel_limit, dimension_limit,
):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "MAX_IMAGE_PIXELS", pixel_limit, raising=False)
    monkeypatch.setattr(parser, "MAX_IMAGE_DIMENSION", dimension_limit, raising=False)
    upload = png_bytes(size)
    original_open = Image.open
    original_tempfile = parser.tempfile.NamedTemporaryFile

    def open_without_loading(*args, **kwargs):
        image = original_open(*args, **kwargs)
        monkeypatch.setattr(image, "load", lambda: pytest.fail("Rejected image must not be decoded"))
        return image

    def temporary_upload(*args, **kwargs):
        kwargs["dir"] = tmp_path
        return original_tempfile(*args, **kwargs)

    monkeypatch.setattr(parser.Image, "open", open_without_loading)
    monkeypatch.setattr(parser.tempfile, "NamedTemporaryFile", temporary_upload)
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: pytest.fail("Rejected image must not reach OCR"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32}, files={"file": ("scan.png", upload, "image/png")},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": f"Image exceeds the {pixel_limit}-pixel or {dimension_limit}-pixel dimension limit",
    }
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("width,height,user_unit", [
    (1440.01, 72, 1),
    (72, 1440.01, 1),
    (721, 72, 2),
])
def test_oversized_pdf_pages_rejected_before_rendering_and_upload_removed(
    monkeypatch, tmp_path, width, height, user_unit,
):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    original_tempfile = parser.tempfile.NamedTemporaryFile

    def temporary_upload(*args, **kwargs):
        kwargs["dir"] = tmp_path
        return original_tempfile(*args, **kwargs)

    monkeypatch.setattr(parser.tempfile, "NamedTemporaryFile", temporary_upload)
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: pytest.fail("Oversized page must not be rendered"))
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: pytest.fail("Oversized page must not reach OCR"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.pdf", pdf_bytes(width, height, user_unit), "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": f"PDF page exceeds the {parser.MAX_PDF_RENDER_DIMENSION}-pixel rendering limit",
    }
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("width,height,user_unit", [
    (0, 72, 1),
    (-1, 72, 1),
    (72, 0, 1),
    (72, -1, 1),
    (72, 72, 0),
    (72, 72, -1),
    ("nan", 72, 1),
    (72, "inf", 1),
    (72, 72, "nan"),
    (72, 72, "inf"),
    (72, 72, "invalid"),
])
def test_invalid_pdf_dimensions_rejected_before_rendering(monkeypatch, width, height, user_unit):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: pytest.fail("Invalid page must not be rendered"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.pdf", pdf_bytes(width, height, user_unit), "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid PDF page dimensions"}


@pytest.mark.parametrize("width,height,user_unit,rotation,expected_edge", [
    (612, 792, 1, 0, 2200),
    (720, 72, 2, 0, 4000),
    (1440, 72, 1, 90, 4000),
])
def test_valid_pdf_pages_have_bounded_poppler_output_and_preserve_ocr(
    monkeypatch, width, height, user_unit, rotation, expected_edge,
):
    import pdf2image.pdf2image as renderer

    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(renderer, "pdfinfo_from_path", lambda *args, **kwargs: {"Pages": 1})
    monkeypatch.setattr(renderer, "_get_poppler_version", lambda *args, **kwargs: (24, 0))
    commands = []
    recognized_images = []

    class PopplerProcess:
        def __init__(self, command, **kwargs):
            commands.append(command)

        def communicate(self, timeout=None):
            return b"P6\n2 2\n255\n" + b"\xff\xff\xff" * 4, b""

    def recognize(image):
        recognized_images.append(image)
        assert image.getpixel((0, 0)) == (255, 255, 255)
        return "Reviewed PDF text"

    monkeypatch.setattr(renderer, "Popen", PopplerProcess)
    monkeypatch.setattr(parser.pytesseract, "image_to_string", recognize)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.pdf", pdf_bytes(width, height, user_unit, rotation), "application/pdf")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "Reviewed PDF text"
    assert response.json()["page_count"] == 1
    assert response.json()["ocr_pages_used"] == [1]
    assert len(commands) == 1
    command = commands[0]
    assert command[command.index("-scale-to") + 1] == str(expected_edge)
    assert expected_edge <= parser.MAX_PDF_RENDER_DIMENSION
    assert command[command.index("-f") + 1] == "1"
    assert command[command.index("-l") + 1] == "1"
    assert len(recognized_images) == 1
    with pytest.raises(ValueError, match="closed"):
        recognized_images[0].getpixel((0, 0))


def test_pdf_rendered_image_closed_when_ocr_fails(monkeypatch):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    rendered = Image.new("RGB", (2, 2), "white")
    monkeypatch.setattr(parser, "convert_from_path", lambda *args, **kwargs: [rendered])

    def failed_ocr(image):
        raise RuntimeError("OCR unavailable")

    monkeypatch.setattr(parser.pytesseract, "image_to_string", failed_ocr)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.pdf", pdf_bytes(), "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unable to parse document"}
    with pytest.raises(ValueError, match="closed"):
        rendered.getpixel((0, 0))


@pytest.mark.parametrize("variant,extension", [
    ("lossy", "webp"),
    ("lossless", "webp"),
    ("extended", "webp"),
    ("lossy", "png"),
])
def test_webp_variants_at_limits_are_decoded_and_preserve_text(monkeypatch, variant, extension):
    upload = webp_bytes(variant)
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "MAX_IMAGE_PIXELS", 20)
    monkeypatch.setattr(parser, "MAX_IMAGE_DIMENSION", 5)
    decoded_sizes = []

    def recognize(image):
        image.load()
        decoded_sizes.append(image.size)
        return "WebP chart text"

    monkeypatch.setattr(parser.pytesseract, "image_to_string", recognize)
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": (f"scan.{extension}", upload, "image/webp")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "WebP chart text"
    assert decoded_sizes == [(5, 4)]


@pytest.mark.parametrize("variant,extension,pixel_limit,dimension_limit", [
    ("lossy", "webp", 19, 10),
    ("lossless", "webp", 100, 4),
    ("extended", "webp", 19, 10),
    ("extended", "png", 100, 4),
    ("lossless", "png", 19, 10),
])
def test_oversized_webp_rejected_before_decoder_allocation(
    monkeypatch, variant, extension, pixel_limit, dimension_limit,
):
    upload = webp_bytes(variant)
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser, "MAX_IMAGE_PIXELS", pixel_limit)
    monkeypatch.setattr(parser, "MAX_IMAGE_DIMENSION", dimension_limit)
    monkeypatch.setattr(
        WebPImagePlugin._webp, "WebPAnimDecoder",
        lambda *args, **kwargs: pytest.fail("Oversized WebP must not allocate a decoder"),
    )
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: pytest.fail("Rejected WebP must not reach OCR"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": (f"scan.{extension}", upload, "image/webp")},
    )
    assert response.status_code == 422
    assert response.json() == {
        "detail": f"Image exceeds the {pixel_limit}-pixel or {dimension_limit}-pixel dimension limit",
    }


@pytest.mark.parametrize("upload", [
    b"RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0\0",
    b"RIFF\x16\0\0\0WEBPVP8L\x05\0\0\0/\0",
    b"RIFF\x16\0\0\0WEBPVP8 \x0a\0\0\0\0",
])
def test_truncated_webp_headers_rejected_before_decoder_allocation(monkeypatch, upload):
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(
        WebPImagePlugin._webp, "WebPAnimDecoder",
        lambda *args, **kwargs: pytest.fail("Malformed WebP must not allocate a decoder"),
    )
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.webp", upload, "image/webp")},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unable to parse document"}


def test_unsupported_image_content_is_rejected_despite_supported_filename(monkeypatch):
    buffer = io.BytesIO()
    with Image.new("RGB", (4, 4), "white") as image:
        image.save(buffer, format="GIF")
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    monkeypatch.setattr(parser.pytesseract, "image_to_string", lambda image: pytest.fail("Unsupported image content must not reach OCR"))
    response = TestClient(parser.app).post(
        "/parse", headers={"X-API-Key": "a" * 32},
        files={"file": ("scan.png", buffer.getvalue(), "image/png")},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Unable to parse document"}


def test_real_ocr_and_poppler_smoke(monkeypatch):
    if not shutil.which("tesseract") or not shutil.which("pdftoppm"):
        if os.getenv("CI"):
            pytest.fail("tesseract and pdftoppm must be installed in CI")
        pytest.skip("tesseract/pdftoppm not installed locally")
    monkeypatch.setenv("APP_API_KEY", "a" * 32)
    client = TestClient(parser.app)
    headers = {"X-API-Key": "a" * 32}

    image_resp = client.post("/parse", headers=headers, files={"file": ("scan.png", png_bytes((32, 32)), "image/png")})
    assert image_resp.status_code == 200
    assert image_resp.json()["file_type"] == "png"

    pdf_resp = client.post("/parse", headers=headers, files={"file": ("scan.pdf", pdf_bytes(), "application/pdf")})
    assert pdf_resp.status_code == 200
    assert pdf_resp.json()["page_count"] == 1
    assert pdf_resp.json()["ocr_pages_used"] == [1]
