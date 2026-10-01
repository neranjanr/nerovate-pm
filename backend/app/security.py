import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

ACCESS_MINUTES = 60
REFRESH_DAYS = 7


def jwt_secret() -> str:
    return os.environ.get("JWT_SECRET", "dev-only-change-me")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _encode(payload: dict) -> str:
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    return _encode({"sub": str(user_id), "type": "access", "exp": now + timedelta(minutes=ACCESS_MINUTES)})


def create_refresh_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    return _encode({"sub": str(user_id), "type": "refresh", "exp": now + timedelta(days=REFRESH_DAYS)})


def decode_token(token: str) -> dict:
    return jwt.decode(token, jwt_secret(), algorithms=["HS256"])
