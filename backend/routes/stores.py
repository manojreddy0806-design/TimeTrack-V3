# backend/routes/stores.py
from flask import Blueprint, request, jsonify
from ..models import (
    get_stores, create_store, delete_store, get_store_by_username, update_store,
    add_yubikey, remove_yubikey, is_yubikey_authorized, verify_yubikey_otp,
    verify_password
)
from ..config import Config

bp = Blueprint("stores", __name__)

@bp.get("/")
def list_stores():
    stores = get_stores()
    # Don't return passwords in the list
    for store in stores:
        store.pop("password", None)
    return jsonify(stores)

@bp.post("/")
def add_store():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        name = data.get("name")
        if not name:
            return jsonify({"error": "Store name is required"}), 400
        if len(name) > 100:
            return jsonify({"error": "Store name is too long (max 100 characters)"}), 400
        
        username = data.get("username")
        if not username:
            return jsonify({"error": "Username is required"}), 400
        if len(username) > 50:
            return jsonify({"error": "Username is too long (max 50 characters)"}), 400
        
        password = data.get("password")
        if not password:
            return jsonify({"error": "Password is required"}), 400
        if len(password) > 200:
            return jsonify({"error": "Password is too long (max 200 characters)"}), 400
        
        total_boxes = data.get("total_boxes")
        if total_boxes is None:
            return jsonify({"error": "Total boxes is required"}), 400
        
        # Validate total_boxes is a positive integer
        try:
            total_boxes = int(total_boxes)
            if total_boxes < 1:
                return jsonify({"error": "Total boxes must be a positive integer"}), 400
        except (ValueError, TypeError):
            return jsonify({"error": "Total boxes must be a positive integer"}), 400
        
        store_id = create_store(name, username, password, total_boxes)
        # Return store info without password
        store_info = {"id": store_id, "name": name, "username": username, "total_boxes": total_boxes}
        return jsonify(store_info), 201
    except Exception as e:
        # Log the error for debugging (server-side only)
        import traceback
        import os
        error_msg = str(e)
        traceback.print_exc()
        # Don't expose internal error details to client in production
        if os.getenv("FLASK_ENV") == "development":
            return jsonify({"error": f"Failed to create store: {error_msg}"}), 500
        else:
            return jsonify({"error": "Failed to create store. Please try again."}), 500

@bp.post("/login")
def store_login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    yubikey_otp = data.get("yubikey_otp", "").strip()  # YubiKey OTP from client
    
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    
    store = get_store_by_username(username)
    if not store:
        return jsonify({"error": "Invalid credentials"}), 401
    
    stored_password = store.get("password")
    if not stored_password:
        return jsonify({"error": "Invalid credentials"}), 401
    
    if verify_password(password, stored_password):
        # Check YubiKey authorization
        yubikey_ids = store.get("yubikey_ids", [])
        if len(yubikey_ids) == 0:
            return jsonify({
                "error": "No YubiKeys are registered for this store. Please contact your manager to register a YubiKey first."
            }), 403
        
        if not yubikey_otp:
            return jsonify({
                "error": "YubiKey OTP is required. Please touch your YubiKey to generate an OTP."
            }), 400
        
        # Verify YubiKey OTP and extract public ID
        is_valid, public_id = verify_yubikey_otp(yubikey_otp)
        if not is_valid:
            return jsonify({
                "error": "Invalid YubiKey OTP. Please try again or contact your manager."
            }), 403
        
        # Check if this YubiKey is authorized for this store
        if not is_yubikey_authorized(store.get("name"), public_id):
            return jsonify({
                "error": "This YubiKey is not authorized for this store. Please contact your manager to register this YubiKey."
            }), 403
        
        # Don't return password
        store.pop("password", None)
        return jsonify(store), 200
    else:
        return jsonify({"error": "Invalid credentials"}), 401

@bp.put("/")
def edit_store():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request body is required"}), 400
        
        name = data.get("name")
        if not name:
            return jsonify({"error": "Store name is required"}), 400
        
        new_name = data.get("new_name")
        username = data.get("username")
        password = data.get("password")
        total_boxes = data.get("total_boxes")
        
        # Validate total_boxes if provided
        if total_boxes is not None:
            try:
                total_boxes = int(total_boxes)
                if total_boxes < 1:
                    return jsonify({"error": "Total boxes must be a positive integer"}), 400
            except (ValueError, TypeError):
                return jsonify({"error": "Total boxes must be a positive integer"}), 400
        
        success = update_store(name, new_name=new_name, username=username, password=password, total_boxes=total_boxes)
        if success:
            # Return updated store info
            stores = get_stores()
            updated_store = next((s for s in stores if s.get("name") == (new_name or name)), None)
            if updated_store:
                updated_store.pop("password", None)
                return jsonify(updated_store), 200
            return jsonify({"message": f"Store '{name}' updated successfully"}), 200
        else:
            return jsonify({"error": f"Store '{name}' not found or no changes made"}), 404
    except Exception as e:
        import traceback
        import os
        error_msg = str(e)
        traceback.print_exc()
        # Don't expose internal error details to client in production
        if os.getenv("FLASK_ENV") == "development":
            return jsonify({"error": f"Failed to update store: {error_msg}"}), 500
        else:
            return jsonify({"error": "Failed to update store. Please try again."}), 500

@bp.delete("/")
def remove_store():
    data = request.get_json()
    name = data.get("name")
    if not name:
        return jsonify({"error": "Store name is required"}), 400
    
    success = delete_store(name)
    if success:
        return jsonify({"message": f"Store '{name}' deleted successfully"}), 200
    else:
        return jsonify({"error": f"Store '{name}' not found"}), 404

@bp.post("/manager/login")
def manager_login():
    """Manager login endpoint - validates credentials server-side"""
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    
    # Validate against config (from environment variables in production)
    if username == Config.MANAGER_USERNAME and password == Config.MANAGER_PASSWORD:
        return jsonify({
            "role": "manager",
            "name": "Manager",
            "username": username
        }), 200
    else:
        return jsonify({"error": "Invalid credentials"}), 401

@bp.post("/yubikey/register")
def register_yubikey():
    """Register a YubiKey for a store (manager only)"""
    # Note: In a production environment, add proper session/authentication check here
    try:
        data = request.get_json()
        store_name = data.get("store_name")
        yubikey_otp = data.get("yubikey_otp", "").strip()  # OTP to extract public ID
        yubikey_name = data.get("yubikey_name", "YubiKey")
        
        if not store_name or not yubikey_otp:
            return jsonify({"error": "Store name and YubiKey OTP are required"}), 400
        
        # Validate input lengths
        if len(store_name) > 100 or len(yubikey_name) > 200:
            return jsonify({"error": "Input too long"}), 400
        
        # Verify OTP and extract public ID
        is_valid, public_id = verify_yubikey_otp(yubikey_otp)
        if not is_valid:
            return jsonify({"error": "Invalid YubiKey OTP. Please touch your YubiKey to generate a valid OTP."}), 400
        
        if not public_id:
            return jsonify({"error": "Failed to extract YubiKey ID from OTP"}), 400
        
        success = add_yubikey(store_name, public_id, yubikey_name)
        if success:
            return jsonify({"message": "YubiKey registered successfully", "yubikey_id": public_id}), 200
        else:
            return jsonify({"error": "Failed to register YubiKey or store not found"}), 404
    except Exception as e:
        return jsonify({"error": "Failed to register YubiKey"}), 500

@bp.delete("/yubikey/remove")
def remove_yubikey_endpoint():
    """Remove a YubiKey from a store (manager only)"""
    # Note: In a production environment, add proper session/authentication check here
    try:
        data = request.get_json()
        store_name = data.get("store_name")
        yubikey_id = data.get("yubikey_id")
        
        if not store_name or not yubikey_id:
            return jsonify({"error": "Store name and YubiKey ID are required"}), 400
        
        # Validate input lengths and format
        if len(store_name) > 100 or len(yubikey_id) != 12:
            return jsonify({"error": "Invalid input"}), 400
        
        success = remove_yubikey(store_name, yubikey_id)
        if success:
            return jsonify({"message": "YubiKey removed successfully"}), 200
        else:
            return jsonify({"error": "Failed to remove YubiKey or store not found"}), 404
    except Exception as e:
        return jsonify({"error": "Failed to remove YubiKey"}), 500

@bp.get("/yubikey/list")
def list_yubikeys():
    """List all authorized YubiKeys for a store"""
    try:
        store_name = request.args.get("store_name")
        if not store_name:
            return jsonify({"error": "Store name is required"}), 400
        
        stores = get_stores()
        store = next((s for s in stores if s.get("name") == store_name), None)
        
        if not store:
            return jsonify({"error": "Store not found"}), 404
        
        yubikey_ids = store.get("yubikey_ids", [])
        return jsonify({"yubikeys": yubikey_ids}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

