# backend/routes/inventory.py
from flask import Blueprint, request, jsonify
from ..models import get_inventory, add_inventory_item, update_inventory_item, delete_inventory_item

bp = Blueprint("inventory", __name__)

@bp.route("/", methods=["GET"])
def list_inventory():
    store_id = request.args.get("store_id")
    items = get_inventory(store_id)
    return jsonify(items)

@bp.route("/", methods=["POST"])
def add_item():
    data = request.get_json()
    item_id = add_inventory_item(
        store_id=data.get("store_id"),
        sku=data.get("sku"),
        name=data.get("name"),
        quantity=data.get("quantity", 0)
    )
    return jsonify({"id": item_id}), 201

@bp.route("/", methods=["PUT"], strict_slashes=False)
def update_item():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body is required"}), 400
    store_id = data.get("store_id")
    item_id = data.get("_id") or data.get("id")  # Support both _id and id
    sku = data.get("sku")  # Old SKU for finding the item (used if item_id not provided)
    quantity = data.get("quantity")
    name = data.get("name")
    new_sku = data.get("new_sku")
    
    # Require either item_id OR (store_id and sku)
    if not item_id and (not store_id or not sku):
        return jsonify({"error": "Either _id or both store_id and sku are required"}), 400
    
    success = update_inventory_item(store_id=store_id, sku=sku, item_id=item_id, quantity=quantity, name=name, new_sku=new_sku)
    if success:
        return jsonify({"message": "Inventory item updated successfully"}), 200
    else:
        # Check if it's because new SKU already exists
        if new_sku:
            from ..models import get_collection
            inventory = get_collection("inventory")
            query = {"store_id": store_id, "sku": new_sku}
            if item_id:
                from bson import ObjectId
                query["_id"] = {"$ne": ObjectId(item_id)}
            existing = inventory.find_one(query)
            if existing:
                return jsonify({"error": f"SKU '{new_sku}' already exists for this store"}), 409
        return jsonify({"error": "Inventory item not found or update failed"}), 404

@bp.route("/", methods=["DELETE"])
def remove_item():
    data = request.get_json()
    store_id = data.get("store_id")
    sku = data.get("sku")
    
    if not store_id or not sku:
        return jsonify({"error": "store_id and sku are required"}), 400
    
    success = delete_inventory_item(store_id, sku)
    if success:
        return jsonify({"message": "Inventory item deleted successfully"}), 200
    else:
        return jsonify({"error": "Inventory item not found"}), 404
