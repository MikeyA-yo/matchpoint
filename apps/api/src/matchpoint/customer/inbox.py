"""GET /customers/{ref}/inbox and GET /messages/{id}/why."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from matchpoint.customer.message_log import message_store

router = APIRouter(tags=["customer"])


@router.get("/customers/{ref}/inbox")
def list_inbox(ref: str):
    messages = message_store.by_customer(ref)
    return {
        "messages": [
            {
                "id": m.id,
                "sent_at": m.sent_at.isoformat(),
                "channel": m.channel,
                "product_id": m.product_id,
                "title": m.title,
                "body": m.body,
                "status": m.status,
                "response": m.response,
            }
            for m in messages
        ]
    }


@router.get("/messages/{message_id}/why")
def message_why(message_id: str):
    msg = message_store.by_id(message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="message not found")
    return {
        "message_id": msg.id,
        "reason": msg.why,
        "data_used": [
            {
                "kind": "transactions, 6 months",
                "source": "core banking",
                "permission": "marketing consent",
            }
        ],
        "consent_url": f"/customers/{msg.customer_ref}/consent",
    }
