from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv

# Ensure root .env is loaded
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if env_path.is_file():
    load_dotenv(env_path)
else:
    load_dotenv()


def _resolve_database_url() -> str:
    raw_url = os.getenv("DATABASE_URL", "").strip()
    if raw_url and "YOUR_POSTGRES_PASSWORD" not in raw_url:
        return raw_url

    user = quote_plus(os.getenv("POSTGRES_USER", "prepfreex_user"))
    password = quote_plus(os.getenv("POSTGRES_PASSWORD", ""))
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "prepfreex")
    if password:
        return f"postgresql://{user}:{password}@{host}:{port}/{db}"

    return f"postgresql://{user}@{host}:{port}/{db}"


def _parse_keys(raw: str) -> tuple[str, ...]:
    return tuple(k.strip() for k in raw.replace("\n", ",").split(",") if k.strip())


@dataclass(frozen=True)
class Settings:
    postgres_host: str = os.getenv("POSTGRES_HOST", "127.0.0.1")
    postgres_user: str = os.getenv("POSTGRES_USER", "prepfreex_user")
    postgres_password: str = os.getenv("POSTGRES_PASSWORD", "")
    postgres_db: str = os.getenv("POSTGRES_DB", "prepfreex")
    postgres_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    database_url: str = _resolve_database_url()

    # LLM settings
    llm_provider: str = os.getenv("LLM_PROVIDER", os.getenv("CLASSIFIER_PROVIDER", "groq"))
    groq_api_keys: tuple[str, ...] = (
        _parse_keys(os.getenv("GROQ_API_KEYS", ""))
        or (_parse_keys(os.getenv("GROQ_API_KEY", "")) if os.getenv("GROQ_API_KEY") else ())
    )
    groq_api_key: str = groq_api_keys[0] if groq_api_keys else os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
    groq_base_url: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    max_llm_tokens_per_minute: int = int(os.getenv("MAX_LLM_TOKENS_PER_MINUTE", "7000"))
    max_llm_tokens_per_day: int = int(os.getenv("MAX_LLM_TOKENS_PER_DAY", "150000"))
    max_llm_requests_per_day: int = int(os.getenv("MAX_LLM_REQUESTS_PER_DAY", "850"))
    llm_requests_per_minute: int = int(os.getenv("LLM_REQUESTS_PER_MINUTE", "25"))
    max_llm_requests: int = int(os.getenv("MAX_LLM_REQUESTS", "100"))

    # Gemini fallback
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # OpenAI-compatible fallback
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "")
    llm_timeout_seconds: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "90"))
    llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0"))

    # Extraction & Tagging
    tag_confidence_threshold: float = float(os.getenv("TAG_CONFIDENCE_THRESHOLD", "0.8"))
    pdf_render_dpi: int = int(os.getenv("PDF_RENDER_DPI", "200"))
    source_snapshot_dpi: int = int(os.getenv("SOURCE_SNAPSHOT_DPI", "220"))
    ocr_enabled: bool = os.getenv("OCR_ENABLED", "true").lower() in {"1", "true", "yes"}
    ocr_language: str = os.getenv("OCR_LANGUAGE", "eng")
    ocr_min_text_chars: int = int(os.getenv("OCR_MIN_TEXT_CHARS", "80"))

    # Standardized Directories
    input_dir: Path = Path(os.getenv("INPUT_DIR", "data/raw/jee_dataset"))
    artifact_dir: Path = Path(os.getenv("ARTIFACT_DIR", "data/jobs"))
    cache_dir: Path = Path(os.getenv("CACHE_DIR", "data/cache"))
    storage_dir: Path = Path(os.getenv("STORAGE_DIR", "data/objects/local"))
    inventory_dir: Path = Path(os.getenv("INVENTORY_DIR", "data/inventory"))
    taxonomy_version: str = os.getenv("TAXONOMY_VERSION", "jee_main_2027")

    # Object Storage Configuration (Local, MinIO AIStor, Neon Object Storage, AWS S3)
    object_storage_backend: str = os.getenv("OBJECT_STORAGE_BACKEND", "local").lower()
    minio_endpoint: str = os.getenv("MINIO_ENDPOINT", "http://127.0.0.1:9000")
    minio_bucket: str = os.getenv("MINIO_BUCKET", "prepfreex-question-assets")
    minio_region: str = os.getenv("MINIO_REGION", "us-east-1")
    minio_access_key: str = os.getenv("MINIO_ACCESS_KEY", "")
    minio_secret_key: str = os.getenv("MINIO_SECRET_KEY", "")
    minio_use_ssl: bool = os.getenv("MINIO_USE_SSL", "false").lower() in {"1", "true", "yes"}
    minio_data_dir: Path = Path(os.getenv("MINIO_DATA_DIR", "C:/PrepFreeX/minio-data"))
    aws_s3_bucket: str = os.getenv("AWS_S3_BUCKET", "prepfreex-question-assets-prod")
    aws_default_region: str = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    neon_endpoint_url_s3: str = os.getenv("AWS_ENDPOINT_URL_S3", "")
    neon_storage_bucket: str = os.getenv("NEON_STORAGE_BUCKET", "assets")
    neon_region: str = os.getenv("AWS_REGION", "ap-southeast-1")


settings = Settings()

