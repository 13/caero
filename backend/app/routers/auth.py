"""Auth router — login, register, me."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.models import AppSettings, User
from app.schemas import (
    AdminUserCreate,
    AdminUserPasswordUpdate,
    ChangePasswordRequest,
    NotificationDefaultsUpdate,
    StarredProductsUpdate,
    Token,
    UserCreate,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Return the current user or None (in single-user mode, always return first user)."""
    if settings.single_user_mode:
        result = await db.execute(select(User).limit(1))
        return result.scalar_one_or_none()

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    from app.auth import decode_token

    decoded = decode_token(token)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    username, token_version = decoded

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if token_version != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    return user


async def require_user(
    user: User | None = Depends(get_current_user),
) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)) -> User:
    user_count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    is_first_user = user_count == 0
    if not is_first_user:
        app_settings = await db.get(AppSettings, 1)
        allow_registration = app_settings.allow_registration if app_settings else True
        if not allow_registration:
            raise HTTPException(status_code=403, detail="User registration is disabled")

    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        is_admin=is_first_user,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.get("/register-enabled")
async def register_enabled(db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    user_count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    if user_count == 0:
        return {"enabled": True}
    app_settings = await db.get(AppSettings, 1)
    return {"enabled": app_settings.allow_registration if app_settings else True}


# Brute-force protection: per client+username sliding window of failed logins.
# In-memory is fine here — the app runs as a single process.
_LOGIN_MAX_FAILURES = 5
_LOGIN_WINDOW_SECONDS = 300
_failed_logins: dict[str, deque[float]] = defaultdict(deque)


def _login_throttle_key(request: Request, username: str) -> str:
    client_ip = request.client.host if request.client else "unknown"
    return f"{client_ip}:{username}"


def _is_login_blocked(key: str) -> bool:
    attempts = _failed_logins[key]
    cutoff = time.monotonic() - _LOGIN_WINDOW_SECONDS
    while attempts and attempts[0] < cutoff:
        attempts.popleft()
    if not attempts:
        # Don't let the dict grow one key per (ip, username) forever.
        del _failed_logins[key]
        return False
    return len(attempts) >= _LOGIN_MAX_FAILURES


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
) -> Token:
    throttle_key = _login_throttle_key(request, form.username)
    if _is_login_blocked(throttle_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Try again in a few minutes.",
        )

    result = await db.execute(select(User).where(User.username == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_password):
        _failed_logins[throttle_key].append(time.monotonic())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    _failed_logins.pop(throttle_key, None)
    return Token(access_token=create_access_token(user.username, user.token_version))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(require_user)) -> User:
    return user


@router.post("/logout")
async def logout(
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    # Bump the token version so every outstanding JWT for this user is revoked.
    user.token_version += 1
    await db.flush()
    return {"message": "Logged out"}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    await db.flush()
    return {"message": "Password changed"}


@router.patch("/me/starred", response_model=UserOut)
async def update_starred_products(
    body: StarredProductsUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if len(body.starred_product_ids) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 starred products allowed")
    user.starred_product_ids = ",".join(str(i) for i in body.starred_product_ids) if body.starred_product_ids else None
    await db.flush()
    await db.refresh(user)
    return user


@router.patch("/me/notification-defaults")
async def update_notification_defaults(
    body: NotificationDefaultsUpdate,
    user: User = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    user.default_email = body.default_email
    user.default_telegram_chat_id = body.default_telegram_chat_id
    await db.flush()
    return {"message": "Notification defaults updated"}


@router.get("/users", response_model=list[UserOut])
async def list_users(_admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)) -> list[User]:
    result = await db.execute(select(User).order_by(User.username.asc()))
    return result.scalars().all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminUserCreate,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        is_admin=body.is_admin,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}/password")
async def admin_change_password(
    user_id: int,
    body: AdminUserPasswordUpdate,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    target.hashed_password = hash_password(body.new_password)
    await db.flush()
    return {"message": "Password updated"}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Admin cannot delete own account")
    await db.delete(target)
