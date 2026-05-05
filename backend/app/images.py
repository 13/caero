import asyncio
import logging
import mimetypes
import os
import uuid
import httpx
import aiofiles
from pathlib import Path

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Product
from app.database import AsyncSessionLocal
from app.config import settings

logger = logging.getLogger(__name__)

def get_images_dir() -> Path:
    # Use the same parent directory as the SQLite db path
    sqlite_path = Path(settings.sqlite_path)
    if sqlite_path.parent.exists() and sqlite_path.parent.is_dir():
        img_dir = sqlite_path.parent / "user_images"
    else:
        img_dir = Path("data/user_images")
    img_dir.mkdir(parents=True, exist_ok=True)
    return img_dir

async def download_image_task(product_id: int, url: str) -> None:
    if not url or url.startswith("/user_images/"):
        return

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()

            ext = mimetypes.guess_extension(resp.headers.get("content-type", ""))
            if not ext:
                if "jpeg" in url.lower() or "jpg" in url.lower(): ext = ".jpg"
                elif "png" in url.lower(): ext = ".png"
                elif "webp" in url.lower(): ext = ".webp"
                else: ext = ".jpg"

            filename = f"prod_{product_id}_{uuid.uuid4().hex[:8]}{ext}"
            images_dir = get_images_dir()
            filepath = images_dir / filename

            async with aiofiles.open(filepath, "wb") as f:
                await f.write(resp.content)

            # Update database: set cached_image_url, keep original image_url untouched
            async with AsyncSessionLocal() as db:
                product = await db.get(Product, product_id)
                if product:
                    old_cached = product.cached_image_url if hasattr(product, 'cached_image_url') else None
                    product.cached_image_url = f"/user_images/{filename}"
                    await db.commit()

                    # Remove previous cached file if it existed
                    if old_cached and old_cached.startswith("/user_images/"):
                        old_path = images_dir / Path(old_cached).name
                        if old_path.exists():
                            os.remove(old_path)

            logger.info("Successfully downloaded image for product %d", product_id)

    except Exception as e:
        logger.warning("Failed to download image for product %d from %s: %s", product_id, url, e)

def schedule_image_download(background_tasks: BackgroundTasks, product_id: int, image_url: str):
    if image_url and not image_url.startswith("/user_images/"):
        background_tasks.add_task(download_image_task, product_id, image_url)

def delete_local_image(image_url: str | None) -> None:
    if not image_url or not image_url.startswith("/user_images/"):
        return
    images_dir = get_images_dir()
    image_path = images_dir / Path(image_url).name
    try:
        if image_path.exists():
            os.remove(image_path)
            logger.info("Deleted cached image %s", image_path)
    except OSError as exc:
        logger.warning("Failed to delete cached image %s: %s", image_path, exc)
