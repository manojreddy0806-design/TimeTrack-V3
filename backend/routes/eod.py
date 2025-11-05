# backend/routes/eod.py
from flask import Blueprint, request, jsonify
from datetime import datetime
from ..models import get_eods, create_eod

bp = Blueprint("eod", __name__)

@bp.get("/")
def list_eod():
    store_id = request.args.get("store_id")
    reports = get_eods(store_id)
    return jsonify(reports)

@bp.post("/")
def add_eod():
    data = request.get_json()
    # Extract values with explicit defaults
    cash_amount = float(data.get("cash_amount", 0) or 0)
    credit_amount = float(data.get("credit_amount", 0) or 0)
    qpay_amount = float(data.get("qpay_amount", 0) or 0)
    boxes_count = int(data.get("boxes_count", 0) or 0)
    total1 = float(data.get("total1", 0) or 0)
    
    # Debug logging
    print(f"EOD Submission received: cash_amount={cash_amount}, credit_amount={credit_amount}, "
          f"qpay_amount={qpay_amount}, boxes_count={boxes_count}, total1={total1}, "
          f"notes={data.get('notes', '')[:50]}")
    
    eod_id = create_eod(
        store_id=data.get("store_id"),
        report_date=data.get("report_date"),
        notes=data.get("notes"),
        cash_amount=cash_amount,
        credit_amount=credit_amount,
        qpay_amount=qpay_amount,
        boxes_count=boxes_count,
        total1=total1,
        submitted_by=data.get("submitted_by")
    )
    
    return jsonify({"id": eod_id}), 201
