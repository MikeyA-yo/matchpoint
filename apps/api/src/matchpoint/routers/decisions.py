"""The decision API. Errors propagate as connector errors and become the shared envelope."""

from fastapi import APIRouter

from matchpoint.pipeline.context import Context
from matchpoint.pipeline.pipeline import evaluate
from matchpoint.pipeline.schemas import Decision, EvaluateRequest
from matchpoint.wiring import get_runtime

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.post("/evaluate", response_model=Decision)
def evaluate_decision(request: EvaluateRequest) -> Decision:
    runtime = get_runtime()
    ctx = Context(
        customer_ref=request.customer_ref,
        as_of=request.as_of or runtime.clock.now(),
        mode=request.mode,
        adapters=runtime.adapters,
        clock=runtime.clock,
        policy=runtime.policy,
        log=runtime.log,
        epoch=runtime.sim.epoch_for(request.customer_ref),
        events=runtime.events,
    )
    return evaluate(ctx)
