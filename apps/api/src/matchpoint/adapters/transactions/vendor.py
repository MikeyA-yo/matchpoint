"""Vendor shape for FLEXCUBE account transaction queries.

Every field here is UNVERIFIED until the Zenith mentor confirms Oracle's REST or
gateway schema. Names follow conventions seen in public FLEXCUBE XSDs (e.g.
QueryAccTrns), but they could be wrong.
"""

from typing import TypedDict


class FlexcubeTxnRow(TypedDict, total=False):
    TRN_REF_NO: str      # unique reference    - UNVERIFIED
    AC_NO: str           # account number       - UNVERIFIED (never logged in domain output)
    TRN_DT: str          # ISO transaction date - UNVERIFIED
    VALUE_DT: str        # ISO value date       - UNVERIFIED
    DRCR_IND: str        # "D" or "C"           - UNVERIFIED
    LCY_AMOUNT: int      # kobo                 - UNVERIFIED (FLEXCUBE normally uses naira)
    TRN_CODE: str        # SAL, NIP, POS, ATM, CHG, STDUTY, REV, ... - UNVERIFIED
    NARRATION: str       # free text            - UNVERIFIED
    RELATED_REF: str     # for reversals        - UNVERIFIED


UNVERIFIED_FIELDS = tuple(FlexcubeTxnRow.__annotations__)
