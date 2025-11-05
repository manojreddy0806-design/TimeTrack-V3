# backend/routes/inventory_history.py
from flask import Blueprint, request, jsonify
from datetime import datetime
from ..models import get_collection

bp = Blueprint("inventory_history", __name__)

@bp.get("/")
def list_inventory_history():
    """Get inventory history snapshots for a store"""
    store_id = request.args.get("store_id")
    
    if not store_id:
        return jsonify({"error": "store_id is required"}), 400
    
    inventory_history = get_collection("inventory_history")
    
    # Get all snapshots for this store, sorted by date (newest first)
    snapshots = list(inventory_history.find(
        {"store_id": store_id},
        {"_id": 0}
    ).sort("snapshot_date", -1))
    
    # Convert datetime objects to ISO format strings
    for snapshot in snapshots:
        if "snapshot_date" in snapshot and isinstance(snapshot["snapshot_date"], datetime):
            snapshot["snapshot_date"] = snapshot["snapshot_date"].isoformat()
        if "created_at" in snapshot and isinstance(snapshot["created_at"], datetime):
            snapshot["created_at"] = snapshot["created_at"].isoformat()
    
    return jsonify(snapshots)

@bp.post("/snapshot")
def create_inventory_snapshot():
    """Create a new inventory snapshot for a store"""
    data = request.get_json()
    
    store_id = data.get("store_id")
    snapshot_date = data.get("snapshot_date")  # Should be YYYY-MM-DD format (device's local date)
    today_date = data.get("today_date")  # Today's date from device's local time
    
    if not store_id:
        return jsonify({"error": "store_id is required"}), 400
    
    # Get current inventory for this store
    inventory = get_collection("inventory")
    items = list(inventory.find({"store_id": store_id}, {"_id": 0}))
    
    # Parse snapshot date - use the date string directly (no timezone conversion)
    if snapshot_date:
        try:
            # If snapshot_date is just YYYY-MM-DD, parse it directly
            if len(snapshot_date) == 10:  # YYYY-MM-DD format
                date_parts = snapshot_date.split('-')
                snapshot_dt = datetime(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), 0, 0, 0)
            else:
                snapshot_dt = datetime.fromisoformat(snapshot_date.replace('Z', '+00:00'))
                # Normalize to midnight
                snapshot_dt = datetime(snapshot_dt.year, snapshot_dt.month, snapshot_dt.day, 0, 0, 0)
        except Exception as parse_err:
            print(f"Error parsing snapshot_date '{snapshot_date}': {parse_err}")
            # Fallback: use today_date if provided, otherwise use current date
            if today_date and len(today_date) == 10:
                date_parts = today_date.split('-')
                snapshot_dt = datetime(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), 0, 0, 0)
            else:
                snapshot_dt = datetime.now()  # Use local server time as fallback
                snapshot_dt = datetime(snapshot_dt.year, snapshot_dt.month, snapshot_dt.day, 0, 0, 0)
    else:
        # Use today_date if provided, otherwise use current date
        if today_date and len(today_date) == 10:
            date_parts = today_date.split('-')
            snapshot_dt = datetime(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), 0, 0, 0)
        else:
            snapshot_dt = datetime.now()  # Use local server time as fallback
            snapshot_dt = datetime(snapshot_dt.year, snapshot_dt.month, snapshot_dt.day, 0, 0, 0)
    
    # Normalize item field names for consistency
    normalized_items = []
    for item in items:
        normalized = {
            "sku": item.get("sku", ""),
            "name": item.get("name", item.get("item_name", "Unknown")),
            "quantity": item.get("quantity", 0),
            "price": item.get("price", 0)
        }
        normalized_items.append(normalized)
    
    # Create snapshot document
    inventory_history = get_collection("inventory_history")
    
    # Get today's date from device's local time for comparison
    # Use today_date from frontend (device's local date), not server UTC time
    if today_date and len(today_date) == 10:
        try:
            date_parts = today_date.split('-')
            today_dt = datetime(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), 0, 0, 0)
        except:
            # Fallback to server local time
            today_dt = datetime.now()
            today_dt = datetime(today_dt.year, today_dt.month, today_dt.day, 0, 0, 0)
    else:
        # Fallback to server local time if today_date not provided
        today_dt = datetime.now()
        today_dt = datetime(today_dt.year, today_dt.month, today_dt.day, 0, 0, 0)
    
    # Check if snapshot already exists for this date
    existing = inventory_history.find_one({
        "store_id": store_id,
        "snapshot_date": snapshot_dt
    })
    
    if existing:
        # Only allow updating today's snapshot - prevent editing past days
        if snapshot_dt < today_dt:
            return jsonify({
                "error": f"Cannot update inventory history for past dates. Snapshot date ({snapshot_dt.date()}) is before today ({today_dt.date()})."
            }), 403
        
        # Update existing snapshot (only allowed for today)
        inventory_history.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "items": normalized_items,
                "updated_at": datetime.now()  # Use local server time
            }}
        )
        return jsonify({"message": "Snapshot updated", "id": str(existing["_id"])}), 200
    else:
        # Prevent creating snapshots for past dates
        if snapshot_dt < today_dt:
            return jsonify({
                "error": f"Cannot create inventory snapshot for past dates. Snapshot date ({snapshot_dt.date()}) is before today ({today_dt.date()})."
            }), 403
        
        # Create new snapshot (only for today or future dates - though future is unlikely)
        doc = {
            "store_id": store_id,
            "snapshot_date": snapshot_dt,
            "items": normalized_items,
            "created_at": datetime.now()  # Use local server time
        }
        
        result = inventory_history.insert_one(doc)
        return jsonify({"message": "Snapshot created", "id": str(result.inserted_id)}), 201
