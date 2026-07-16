from __future__ import annotations

import os
import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


SOLVER_API_TOKEN_MIN_LENGTH = 32

bearer_scheme = HTTPBearer(auto_error=False)


def require_solver_token(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> None:
    """Authenticate trusted server-to-server solver requests."""

    configured_token = os.getenv("SOLVER_API_TOKEN")
    if (
        configured_token is None
        or len(configured_token) < SOLVER_API_TOKEN_MIN_LENGTH
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Solver authentication is not configured",
        )

    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode("utf-8"),
        configured_token.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
