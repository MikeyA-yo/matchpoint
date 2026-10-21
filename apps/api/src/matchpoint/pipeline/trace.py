"""The decision trace, built one step at a time.

`matchpoint.trace` holds the per-request trace ID for logs and the error envelope. This
module holds the trace that travels inside the Decision: which steps ran, what the
detector found, which products were considered, and which rules passed or failed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from matchpoint.pipeline.schemas import (
    Candidate,
    Outcome,
    RuleCheck,
    StepTrace,
    Trace,
    Trigger,
)

MODEL_VERSION = "rules_v1"


@dataclass(frozen=True)
class StepResult:
    """What one pipeline step did. `outcome` is set only when the step stops the run."""

    step: int
    name: str
    reason: str = "OK"
    detail: str = ""
    outcome: Outcome | None = None

    @property
    def proceed(self) -> bool:
        return self.outcome is None


@dataclass
class TraceBuilder:
    steps: list[StepTrace] = field(default_factory=list)
    triggers: list[Trigger] = field(default_factory=list)
    candidates: list[Candidate] = field(default_factory=list)
    rules: list[RuleCheck] = field(default_factory=list)

    def add(self, result: StepResult) -> None:
        self.steps.append(
            StepTrace(
                step=result.step,
                name=result.name,
                status="ok" if result.proceed else "stop",
                reason=result.reason,
                detail=result.detail,
            )
        )

    def check(self, rule: str, passed: bool, detail: str) -> None:
        self.rules.append(RuleCheck(rule=rule, passed=passed, detail=detail))

    def model(self, policy_version: str) -> Trace:
        return Trace(
            triggers=list(self.triggers),
            candidates=list(self.candidates),
            rules=list(self.rules),
            steps=list(self.steps),
            policy_version=policy_version,
            model_version=MODEL_VERSION,
        )
