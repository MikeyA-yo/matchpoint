"""Demo control: start, reset, inject a pattern, read state (docs/api_design.md 5.4).

The simulator itself is only reachable through wiring; these routes are the HTTP edge.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from matchpoint import wiring

router = APIRouter(prefix="/sim", tags=["sim"])

Pattern = Literal["salary_pattern", "fee_season", "sme_growth"]


class SimConfigRequest(BaseModel):
    seed: int = Field(default=42, ge=0)
    n_customers: int = Field(default=5_000, ge=1, le=100_000)
    days: int = Field(default=120, ge=1, le=365)
    scenario: str = Field(default="baseline", max_length=64)


class InjectedEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    pattern: str
    customer_ref: str | None
    affected: int
    at: datetime


class SimStateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seed: int
    n_customers: int
    days: int
    scenario: str
    running: bool
    clock: datetime | None
    simulated: bool
    # How many customers the generator actually has behind n_customers.
    simulated_customers: int
    injected: list[InjectedEventResponse]


class InjectRequest(BaseModel):
    pattern: Pattern
    customer_ref: str | None = None


class InjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    pattern: str
    customer_ref: str | None
    affected: int


@router.post("/start", response_model=SimStateResponse)
def start(config: SimConfigRequest) -> SimStateResponse:
    state = wiring.sim_start(
        seed=config.seed,
        n_customers=config.n_customers,
        days=config.days,
        scenario=config.scenario,
    )
    return SimStateResponse.model_validate(state)


@router.post("/reset", response_model=SimStateResponse)
def reset() -> SimStateResponse:
    return SimStateResponse.model_validate(wiring.sim_reset())


@router.post("/inject", response_model=InjectResponse)
def inject(request: InjectRequest) -> InjectResponse:
    result = wiring.sim_inject(request.pattern, request.customer_ref)
    return InjectResponse.model_validate(result)


@router.get("/state", response_model=SimStateResponse)
def state() -> SimStateResponse:
    return SimStateResponse.model_validate(wiring.sim_state())
