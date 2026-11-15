from __future__ import annotations

import hmac
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

import pytesseract
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pdf2image import convert_from_path
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader

load_dotenv(Path(__file__).with_name(".env"))

MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_PDF_PAGES = 100
MAX_OCR_PAGES = 20
SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff"}
app = FastAPI(title="doc-parser", docs_url=None, redoc_url=None)


@app.middleware("http")
async def authenticate_parse(request: Request, call_next):
    if request.url.path == "/parse" and request.method == "POST":
        expected_key = os.getenv("APP_API_KEY", "")
        supplied_key = request.headers.get("X-API-Key", "")
        if not expected_key or not supplied_key or not hmac.compare_digest(supplied_key, expected_key):
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, object]:
    try:
        tesseract_available = bool(pytesseract.get_tesseract_version())
    except Exception:
        tesseract_available = False
    return {
        "status": "ok",
        "service": "doc-parser",
        "tesseract_available": tesseract_available,
    }


@app.post("/parse")
async def parse_document(
    file: UploadFile = File(...),
) -> JSONResponse:
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type")

    temp_path: Optional[str] = None
    started = time.perf_counter()
    try:
        size = 0
        with tempfile.NamedTemporaryFile(prefix="doc-parser-", suffix=extension, dir="/tmp", delete=False) as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File exceeds 25MB limit")
                temp_file.write(chunk)

        if extension == ".pdf":
            text, page_count, ocr_pages = _extract_pdf(temp_path)
            file_type = "pdf"
        else:
            text = _extract_image(temp_path)
            page_count = 1
            ocr_pages = []
            file_type = extension.removeprefix(".")

        elapsed_ms = round((time.perf_counter() - started) * 1000)
        return JSONResponse({
            "filename": filename,
            "file_type": file_type,
            "page_count": page_count,
            "ocr_pages_used": ocr_pages,
            "text": text,
            "processing_time_ms": elapsed_ms,
        })
    except HTTPException:
        raise
    except (Exception, UnidentifiedImageError) as exc:
        raise HTTPException(status_code=422, detail="Unable to parse document") from exc
    finally:
        await file.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


def _extract_image(path: str) -> str:
    with Image.open(path) as image:
        image.load()
        return pytesseract.image_to_string(image)


def _extract_pdf(path: str) -> tuple[str, int, list[int]]:
    reader = PdfReader(path, strict=False)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are not supported")
    page_text: list[str] = []
    ocr_pages: list[int] = []
    page_count = len(reader.pages)
    if page_count == 0:
        raise ValueError("PDF has no pages")
    if page_count > MAX_PDF_PAGES:
        raise HTTPException(status_code=422, detail=f"PDF exceeds the {MAX_PDF_PAGES}-page processing limit")

    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if len("".join(text.split())) < 15:
            if len(ocr_pages) >= MAX_OCR_PAGES:
                raise HTTPException(status_code=422, detail=f"PDF exceeds the {MAX_OCR_PAGES}-page OCR limit")
            images = convert_from_path(path, dpi=200, first_page=index + 1, last_page=index + 1)
            if not images:
                raise ValueError("Could not render scanned PDF page")
            text = pytesseract.image_to_string(images[0])
            ocr_pages.append(index + 1)
        page_text.append(text.strip())
    return "\n\n".join(page_text), page_count, ocr_pages
