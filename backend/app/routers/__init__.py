from app.routers.auth import router as auth_router
from app.routers.products import router as products_router
from app.routers.prices import router as prices_router
from app.routers.alerts import router as alerts_router
from app.routers.settings import router as settings_router

__all__ = [
    "auth_router",
    "products_router",
    "prices_router",
    "alerts_router",
    "settings_router",
]
