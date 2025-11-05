# backend/routes/face.py
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime
from ..services.face_service import (
    find_best_match, 
    validate_face_descriptor,
    compress_image,
    euclidean_distance
)
from ..models import get_collection

bp = Blueprint("face", __name__)


@bp.post("/add-appearance")
def add_face_appearance():
    """
    Add a new face appearance to an existing employee (used when recognition fails).
    Allows employees to add new face variations without full re-registration.
    
    Request JSON:
    {
        "employee_name": "John Doe",  // or "employee_id": "507f1f77bcf86cd799439011"
        "face_descriptor": [0.123, -0.456, ...],
        "face_image": "data:image/jpeg;base64,..."  // optional
    }
    """
    try:
        data = request.get_json()
        
        employee_name = data.get("employee_name")
        employee_id = data.get("employee_id")
        face_descriptor = data.get("face_descriptor")
        face_image = data.get("face_image")
        
        # Get employee by name or ID
        employees = get_collection("employees")
        
        if employee_name:
            # Search by name (case-insensitive)
            employee = employees.find_one({"name": {"$regex": f"^{employee_name}$", "$options": "i"}})
            if not employee:
                return jsonify({"error": f"Employee '{employee_name}' not found. Please check the spelling."}), 404
        elif employee_id:
            # Search by ID
            try:
                employee = employees.find_one({"_id": ObjectId(employee_id)})
            except:
                return jsonify({"error": "Invalid employee_id format"}), 400
        else:
            return jsonify({"error": "Either employee_name or employee_id is required"}), 400
        
        if not face_descriptor:
            return jsonify({"error": "face_descriptor is required"}), 400
        
        # Validate face descriptor format
        if not validate_face_descriptor(face_descriptor):
            return jsonify({"error": "Invalid face descriptor format. Must be 128-dimensional array"}), 400
        
        # Get employee
        employees = get_collection("employees")
        try:
            employee = employees.find_one({"_id": ObjectId(employee_id)})
        except:
            return jsonify({"error": "Invalid employee_id format"}), 400
        
        if not employee:
            return jsonify({"error": "Employee not found"}), 404
        
        if not employee.get('face_registered'):
            return jsonify({"error": "Employee does not have an initial face registration. Please register face first."}), 400
        
        # Compress face image if provided
        compressed_image = None
        if face_image:
            compressed_image = compress_image(face_image, max_size=400)
        
        # Get existing descriptors
        existing_descriptors = []
        if 'face_descriptors' in employee and isinstance(employee['face_descriptors'], list):
            existing_descriptors = employee['face_descriptors']
        elif 'face_descriptor' in employee:
            existing_descriptors = [employee['face_descriptor']]
        
        # Check if this new descriptor is too similar to existing ones (prevent duplicates)
        min_distance_to_existing = float('inf')
        for existing_desc in existing_descriptors:
            distance = euclidean_distance(face_descriptor, existing_desc)
            if distance < min_distance_to_existing:
                min_distance_to_existing = distance
        
        # Only add if it's different enough (distance > 0.3 means it's a different appearance)
        if min_distance_to_existing < 0.3:
            return jsonify({
                "success": True,
                "message": "Face already registered (very similar to existing registration)",
                "employee_id": employee_id,
                "employee_name": employee.get("name"),
                "total_registrations": len(existing_descriptors)
            }), 200
        
        # Add new descriptor to the list
        existing_descriptors.append(face_descriptor)
        
        # Limit to last 5 registrations
        if len(existing_descriptors) > 5:
            existing_descriptors = existing_descriptors[-5:]
        
        # Update employee with face descriptors array
        update_data = {
            "face_descriptors": existing_descriptors,
            "face_registered": True,
            "face_registered_at": datetime.utcnow()
        }
        
        # Update face_image if provided
        if compressed_image:
            update_data["face_image"] = compressed_image
        
        # Remove old single descriptor format if it exists
        unset_data = {"face_descriptor": ""}
        
        employees.update_one(
            {"_id": employee["_id"]},
            {"$set": update_data, "$unset": unset_data}
        )
        
        return jsonify({
            "success": True,
            "message": "New face appearance added successfully",
            "employee_id": str(employee["_id"]),
            "employee_name": employee.get("name"),
            "total_registrations": len(existing_descriptors)
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.post("/register")
def register_face():
    """
    Register a face descriptor for an employee.
    
    Request JSON:
    {
        "employee_id": "507f1f77bcf86cd799439011",
        "face_descriptor": [0.123, -0.456, ...],  // 128-dimensional array
        "face_image": "data:image/jpeg;base64,..."  // optional
    }
    """
    try:
        data = request.get_json()
        
        employee_id = data.get("employee_id")
        face_descriptor = data.get("face_descriptor")
        face_image = data.get("face_image")
        
        if not employee_id:
            return jsonify({"error": "employee_id is required"}), 400
        
        if not face_descriptor:
            return jsonify({"error": "face_descriptor is required"}), 400
        
        # Validate face descriptor format
        if not validate_face_descriptor(face_descriptor):
            return jsonify({"error": "Invalid face descriptor format. Must be 128-dimensional array"}), 400
        
        # Get employee
        employees = get_collection("employees")
        try:
            employee = employees.find_one({"_id": ObjectId(employee_id)})
        except:
            return jsonify({"error": "Invalid employee_id format"}), 400
        
        if not employee:
            return jsonify({"error": "Employee not found"}), 404
        
        # Check for duplicate face - search all registered employees (only check against other employees)
        all_registered = list(employees.find({
            "face_registered": True,
            "_id": {"$ne": ObjectId(employee_id)}  # Exclude current employee
        }))
        
        if all_registered:
            # Find if this face matches any existing face from other employees
            match = find_best_match(face_descriptor, all_registered, threshold=0.6)
            if match:
                return jsonify({
                    "error": f"This face is already registered to {match['employee_name']}. Each employee must have a unique face.",
                    "duplicate_employee": match['employee_name'],
                    "confidence": match['confidence']
                }), 409  # 409 Conflict
        
        # Compress face image if provided
        compressed_image = None
        if face_image:
            compressed_image = compress_image(face_image, max_size=400)
        
        # Support multiple face descriptors per employee
        # Check if employee already has descriptors
        existing_descriptors = []
        if 'face_descriptors' in employee and isinstance(employee['face_descriptors'], list):
            existing_descriptors = employee['face_descriptors']
        elif 'face_descriptor' in employee:
            # Migrate old single descriptor to new format
            existing_descriptors = [employee['face_descriptor']]
        
        # Check if this new descriptor is too similar to existing ones (prevent duplicates)
        min_distance_to_existing = float('inf')
        for existing_desc in existing_descriptors:
            distance = euclidean_distance(face_descriptor, existing_desc)
            if distance < min_distance_to_existing:
                min_distance_to_existing = distance
        
        # Only add if it's different enough (distance > 0.3 means it's a different appearance)
        if min_distance_to_existing < 0.3:
            return jsonify({
                "success": True,
                "message": "Face already registered (very similar to existing registration)",
                "employee_id": employee_id,
                "employee_name": employee.get("name"),
                "total_registrations": len(existing_descriptors)
            }), 200
        
        # Add new descriptor to the list
        existing_descriptors.append(face_descriptor)
        
        # Update employee with face descriptors array
        update_data = {
            "face_descriptors": existing_descriptors,
            "face_registered": True,
            "face_registered_at": datetime.utcnow()
        }
        
        # Update face_image (use latest image, or keep existing if not provided)
        if compressed_image:
            update_data["face_image"] = compressed_image
        elif "face_image" not in employee:
            # Keep existing image if no new one provided
            pass
        
        # Remove old single descriptor format if it exists
        update_data["$unset"] = {"face_descriptor": ""}
        
        # Clean update_data for MongoDB update
        unset_data = update_data.pop("$unset", {})
        employees.update_one(
            {"_id": ObjectId(employee_id)},
            {"$set": update_data, "$unset": unset_data} if unset_data else {"$set": update_data}
        )
        
        return jsonify({
            "success": True,
            "message": "Face registered successfully",
            "employee_id": employee_id,
            "employee_name": employee.get("name")
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.post("/recognize")
def recognize_face():
    """
    Recognize a face and return matching employee.
    
    Request JSON:
    {
        "face_descriptor": [0.123, -0.456, ...],  // 128-dimensional array
        "store_id": "Lawrence"
    }
    """
    try:
        data = request.get_json()
        
        face_descriptor = data.get("face_descriptor")
        store_id = data.get("store_id")
        
        if not face_descriptor:
            return jsonify({"error": "face_descriptor is required"}), 400
        
        # Note: store_id is optional now since employees are not tied to stores
        
        # Validate face descriptor format
        if not validate_face_descriptor(face_descriptor):
            return jsonify({"error": "Invalid face descriptor format. Must be 128-dimensional array"}), 400
        
        # Get all employees with registered faces (not filtered by store anymore)
        employees = get_collection("employees")
        registered_employees = list(employees.find({
            "face_registered": True
        }))
        
        if not registered_employees:
            return jsonify({
                "success": False,
                "error": "No employees with registered faces found"
            }), 404
        
        # Find best match
        match = find_best_match(face_descriptor, registered_employees, threshold=0.6)
        
        if match:
            return jsonify({
                "success": True,
                "employee_id": match["employee_id"],
                "employee_name": match["employee_name"],
                "confidence": match["confidence"],
                "distance": match["distance"]
            }), 200
        else:
            return jsonify({
                "success": False,
                "error": "Face not recognized. Please contact your manager."
            }), 404
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/employees/<employee_id>")
def get_employee_face(employee_id):
    """
    Get employee face registration status.
    """
    try:
        employees = get_collection("employees")
        
        try:
            employee = employees.find_one({"_id": ObjectId(employee_id)})
        except:
            return jsonify({"error": "Invalid employee_id format"}), 400
        
        if not employee:
            return jsonify({"error": "Employee not found"}), 404
        
        # Count face descriptors
        descriptor_count = 0
        if 'face_descriptors' in employee and isinstance(employee['face_descriptors'], list):
            descriptor_count = len(employee['face_descriptors'])
        elif 'face_descriptor' in employee:
            descriptor_count = 1
        
        return jsonify({
            "employee_id": employee_id,
            "employee_name": employee.get("name"),
            "face_registered": employee.get("face_registered", False),
            "face_registered_at": employee.get("face_registered_at"),
            "has_face_image": "face_image" in employee,
            "face_registrations_count": descriptor_count
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
