import asyncio
from sqlalchemy import select, func, desc, or_
from app.models import Product, PriceHistory
from app.database import get_db
print("Test ok")
