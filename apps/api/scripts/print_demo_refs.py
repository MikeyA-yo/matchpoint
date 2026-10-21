"""Print the seven demo customer refs for curl and the demo script.

Refs are keyed HMACs, so they are stable for a given REF_HMAC_KEY and never expose the
source customer ID. Run with: uv run python scripts/print_demo_refs.py
"""

from matchpoint.wiring import demo_customer_refs


def main() -> None:
    refs = demo_customer_refs()
    width = max(len(key) for key in refs)
    for key in sorted(refs):
        print(f"{key:<{width}}  {refs[key]}")


if __name__ == "__main__":
    main()
