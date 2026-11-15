# Document parser service

FastAPI service for extracting embedded PDF text and OCR text from scanned PDF pages and images. Uploads are streamed to `/tmp` and removed after processing.

## API

- `GET /health` is unauthenticated.
- `POST /parse` accepts `multipart/form-data` field `file` and requires `X-API-Key`.
- Supported extensions: PDF, PNG, JPG/JPEG, WEBP, TIFF. Files are limited to 25 MiB; PDFs are limited to 100 pages and 20 OCR-rendered pages per request.

## Install on Debian

Copy these files into `/data/home/doc-parser` on Debian, then run `sudo bash install-debian.sh`. The script installs the OS packages, creates the isolated venv, generates `.env` only when missing, and enables a systemd service that restarts on failure and boot. It runs as the invoking user by default (`SERVICE_USER` can override that).

For a manual installation, install `tesseract-ocr`, `poppler-utils`, `libgl1`, Python 3, and `python3-venv`, then:

```sh
cd /data/home/doc-parser
python3 -m venv venv
venv/bin/pip install -r requirements.txt
umask 077
test -f .env || printf 'APP_API_KEY=%s\n' "$(openssl rand -hex 16)" > .env
```

Copy `doc-parser.service` to `/etc/systemd/system/doc-parser@.service`, then run `systemctl enable --now doc-parser@$(id -un)`. The service binds to `0.0.0.0:8000`.

The API key stays on the VM and in the backend environment. Do not put it in frontend variables or commit `.env`.
