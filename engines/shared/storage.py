from __future__ import annotations

import hashlib
import json
import mimetypes
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from pydantic import BaseModel, Field


class ObjectMetadata(BaseModel):
    """Metadata describing a stored object."""
    bucket: str
    key: str
    size_bytes: int
    sha256: str
    content_type: str = "application/octet-stream"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    etag: str | None = None
    custom_metadata: dict[str, str] = Field(default_factory=dict)


class BaseObjectStorage(ABC):
    """Abstract interface for object storage (Local / S3 / R2)."""

    @abstractmethod
    def put_object(
        self,
        bucket: str,
        key: str,
        data: bytes | BinaryIO | Path,
        content_type: str | None = None,
        custom_metadata: dict[str, str] | None = None,
    ) -> ObjectMetadata:
        pass

    @abstractmethod
    def get_object(self, bucket: str, key: str) -> bytes:
        pass

    @abstractmethod
    def get_object_stream(self, bucket: str, key: str, chunk_size: int = 65536) -> Iterator[bytes]:
        pass

    @abstractmethod
    def exists(self, bucket: str, key: str) -> bool:
        pass

    @abstractmethod
    def delete_object(self, bucket: str, key: str) -> bool:
        pass

    @abstractmethod
    def head_object(self, bucket: str, key: str) -> ObjectMetadata:
        pass

    @abstractmethod
    def get_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        pass

    @abstractmethod
    def list_objects(self, bucket: str, prefix: str = "") -> list[ObjectMetadata]:
        pass


class LocalObjectStorage(BaseObjectStorage):
    """Local filesystem object storage mimicking S3 bucket/key conventions."""

    def __init__(self, root_dir: Path | str = Path("data/objects/local")):
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, bucket: str, key: str) -> Path:
        clean_bucket = bucket.strip("/\\ ")
        clean_key = key.lstrip("/\\")
        target = (self.root_dir / clean_bucket / clean_key).resolve()
        if not str(target).startswith(str(self.root_dir)):
            raise ValueError(f"Path traversal detected: {bucket}/{key}")
        return target

    def _meta_path(self, target: Path) -> Path:
        return target.with_name(f"{target.name}.meta.json")

    def put_object(
        self,
        bucket: str,
        key: str,
        data: bytes | BinaryIO | Path,
        content_type: str | None = None,
        custom_metadata: dict[str, str] | None = None,
    ) -> ObjectMetadata:
        target = self._resolve_path(bucket, key)
        target.parent.mkdir(parents=True, exist_ok=True)

        hasher = hashlib.sha256()
        size_bytes = 0

        tmp_target = target.with_suffix(f".tmp_{os.getpid()}")
        with tmp_target.open("wb") as out:
            if isinstance(data, bytes):
                out.write(data)
                hasher.update(data)
                size_bytes = len(data)
            elif isinstance(data, Path):
                with data.open("rb") as src:
                    while chunk := src.read(65536):
                        out.write(chunk)
                        hasher.update(chunk)
                        size_bytes += len(chunk)
            else:
                while chunk := data.read(65536):
                    out.write(chunk)
                    hasher.update(chunk)
                    size_bytes += len(chunk)

        if target.exists():
            target.unlink()
        tmp_target.rename(target)

        sha256_hex = hasher.hexdigest()
        detected_content_type = content_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"

        meta = ObjectMetadata(
            bucket=bucket,
            key=key,
            size_bytes=size_bytes,
            sha256=sha256_hex,
            content_type=detected_content_type,
            etag=sha256_hex,
            custom_metadata=custom_metadata or {},
        )

        self._meta_path(target).write_text(meta.model_dump_json(indent=2), encoding="utf-8")
        return meta

    def get_object(self, bucket: str, key: str) -> bytes:
        target = self._resolve_path(bucket, key)
        if not target.is_file():
            raise FileNotFoundError(f"Object not found: {bucket}/{key}")
        return target.read_bytes()

    def get_object_stream(self, bucket: str, key: str, chunk_size: int = 65536) -> Iterator[bytes]:
        target = self._resolve_path(bucket, key)
        if not target.is_file():
            raise FileNotFoundError(f"Object not found: {bucket}/{key}")
        with target.open("rb") as f:
            while chunk := f.read(chunk_size):
                yield chunk

    def exists(self, bucket: str, key: str) -> bool:
        return self._resolve_path(bucket, key).is_file()

    def delete_object(self, bucket: str, key: str) -> bool:
        target = self._resolve_path(bucket, key)
        meta_target = self._meta_path(target)
        deleted = False
        if target.is_file():
            target.unlink()
            deleted = True
        if meta_target.is_file():
            meta_target.unlink()
        return deleted

    def head_object(self, bucket: str, key: str) -> ObjectMetadata:
        target = self._resolve_path(bucket, key)
        if not target.is_file():
            raise FileNotFoundError(f"Object not found: {bucket}/{key}")
        meta_target = self._meta_path(target)
        if meta_target.is_file():
            try:
                return ObjectMetadata.model_validate_json(meta_target.read_text(encoding="utf-8"))
            except Exception:
                pass
        stat = target.stat()
        hasher = hashlib.sha256()
        with target.open("rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return ObjectMetadata(
            bucket=bucket,
            key=key,
            size_bytes=stat.st_size,
            sha256=hasher.hexdigest(),
            content_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
            etag=hasher.hexdigest(),
        )

    def get_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        target = self._resolve_path(bucket, key)
        return target.as_uri()

    def list_objects(self, bucket: str, prefix: str = "") -> list[ObjectMetadata]:
        bucket_dir = self.root_dir / bucket.strip("/\\ ")
        if not bucket_dir.is_dir():
            return []
        results = []
        for p in bucket_dir.rglob("*"):
            if p.is_file() and not p.name.endswith(".meta.json") and not p.name.endswith(".gitkeep"):
                rel_key = str(p.relative_to(bucket_dir)).replace("\\", "/")
                if rel_key.startswith(prefix):
                    results.append(self.head_object(bucket, rel_key))
        return results


class S3ObjectStorage(BaseObjectStorage):
    """S3-compatible object storage provider (AWS S3, MinIO AIStor, Cloudflare R2)."""

    def __init__(
        self,
        endpoint_url: str | None = None,
        aws_access_key_id: str | None = None,
        aws_secret_access_key: str | None = None,
        region_name: str = "us-east-1",
        use_ssl: bool = False,
        addressing_style: str = "path",
    ):
        self.endpoint_url = endpoint_url
        self.aws_access_key_id = aws_access_key_id
        self.aws_secret_access_key = aws_secret_access_key
        self.region_name = region_name
        self.use_ssl = use_ssl
        self.addressing_style = addressing_style
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                import boto3
                from botocore.config import Config

                config = Config(
                    signature_version="s3v4",
                    s3={"addressing_style": self.addressing_style},
                    retries={"max_attempts": 3, "mode": "standard"},
                )
                self._client = boto3.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.aws_access_key_id,
                    aws_secret_access_key=self.aws_secret_access_key,
                    region_name=self.region_name,
                    use_ssl=self.use_ssl,
                    config=config,
                )
            except ImportError:
                raise RuntimeError("boto3 is required for S3ObjectStorage. Install via `pip install boto3`.")
        return self._client

    def put_object(
        self,
        bucket: str,
        key: str,
        data: bytes | BinaryIO | Path,
        content_type: str | None = None,
        custom_metadata: dict[str, str] | None = None,
    ) -> ObjectMetadata:
        client = self._get_client()
        content_type = content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        metadata = custom_metadata or {}

        if isinstance(data, Path):
            body_bytes = data.read_bytes()
        elif isinstance(data, bytes):
            body_bytes = data
        else:
            body_bytes = data.read()

        sha256_hex = hashlib.sha256(body_bytes).hexdigest()
        metadata["sha256"] = sha256_hex

        resp = client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body_bytes,
            ContentType=content_type,
            Metadata=metadata,
        )
        return ObjectMetadata(
            bucket=bucket,
            key=key,
            size_bytes=len(body_bytes),
            sha256=sha256_hex,
            content_type=content_type,
            etag=resp.get("ETag", "").strip('"'),
            custom_metadata=metadata,
        )

    def get_object(self, bucket: str, key: str) -> bytes:
        client = self._get_client()
        resp = client.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()

    def get_object_stream(self, bucket: str, key: str, chunk_size: int = 65536) -> Iterator[bytes]:
        client = self._get_client()
        resp = client.get_object(Bucket=bucket, Key=key)
        stream = resp["Body"]
        while chunk := stream.read(chunk_size):
            yield chunk

    def exists(self, bucket: str, key: str) -> bool:
        client = self._get_client()
        try:
            client.head_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False

    def delete_object(self, bucket: str, key: str) -> bool:
        client = self._get_client()
        try:
            client.delete_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False

    def head_object(self, bucket: str, key: str) -> ObjectMetadata:
        client = self._get_client()
        resp = client.head_object(Bucket=bucket, Key=key)
        custom = resp.get("Metadata", {})
        return ObjectMetadata(
            bucket=bucket,
            key=key,
            size_bytes=resp.get("ContentLength", 0),
            sha256=custom.get("sha256", ""),
            content_type=resp.get("ContentType", "application/octet-stream"),
            etag=resp.get("ETag", "").strip('"'),
            custom_metadata=custom,
        )

    def get_url(self, bucket: str, key: str, expires_in: int = 3600) -> str:
        client = self._get_client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def list_objects(self, bucket: str, prefix: str = "") -> list[ObjectMetadata]:
        client = self._get_client()
        resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        results = []
        for item in resp.get("Contents", []):
            results.append(
                ObjectMetadata(
                    bucket=bucket,
                    key=item["Key"],
                    size_bytes=item.get("Size", 0),
                    sha256="",
                    etag=item.get("ETag", "").strip('"'),
                )
            )
        return results


def get_storage(provider: str | None = None, root_dir: Path | str | None = None) -> BaseObjectStorage:
    """Factory for object storage providers (local, minio, aws_s3)."""
    from engines.shared.config import settings

    target_provider = (provider or settings.object_storage_backend).lower()

    if target_provider == "local":
        return LocalObjectStorage(root_dir=root_dir or settings.storage_dir)
    elif target_provider == "minio":
        return S3ObjectStorage(
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            region_name=settings.minio_region,
            use_ssl=settings.minio_use_ssl,
            addressing_style="path",
        )
    elif target_provider in {"neon", "neon_s3", "neon_object_storage", "object_storage"}:
        return S3ObjectStorage(
            endpoint_url=settings.neon_endpoint_url_s3 or os.getenv("AWS_ENDPOINT_URL_S3"),
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=settings.neon_region or os.getenv("AWS_REGION", "ap-southeast-1"),
            use_ssl=True,
            addressing_style="path",  # Path-style addressing required by Neon
        )
    elif target_provider in {"aws_s3", "s3", "r2"}:
        return S3ObjectStorage(
            endpoint_url=None,  # Standard AWS S3 endpoint
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=settings.aws_default_region,
            use_ssl=True,
            addressing_style="auto",
        )
    raise ValueError(f"Unknown storage provider: {target_provider} (supported: local, minio, neon, aws_s3)")

