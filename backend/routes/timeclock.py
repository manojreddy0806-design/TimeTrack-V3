# backend/routes/timeclock.py
from flask import Blueprint, request, jsonify
from bson import ObjectId
from datetime import datetime, timedelta
from ..models import get_collection
from ..services.face_service import (
    find_best_match,
    validate_face_descriptor,
    compress_image,
    euclidean_distance
)

bp = Blueprint("timeclock", __name__)


@bp.post("/clock-in")
def clock_in_route():
    """Legacy clock-in endpoint (kept for compatibility)"""
    data = request.get_json()
    employee_id = data.get("employee_id")
    
    timeclock = get_collection("timeclock")
    doc = {
        "employee_id": employee_id,
        "clock_in": datetime.utcnow(),
        "clock_out": None
    }
    result = timeclock.insert_one(doc)
    return jsonify({"entry_id": str(result.inserted_id)}), 201


@bp.post("/clock-out")
def clock_out_route():
    """Legacy clock-out endpoint (kept for compatibility)"""
    data = request.get_json()
    entry_id = data.get("entry_id")
    
    try:
        timeclock = get_collection("timeclock")
        result = timeclock.update_one(
            {"_id": ObjectId(entry_id)},
            {"$set": {"clock_out": datetime.utcnow()}}
        )
        
        if result.modified_count > 0:
            return jsonify({"ok": True})
        else:
            return jsonify({"error": "Invalid or already clocked out entry"}), 400
    except:
        return jsonify({"error": "Invalid entry_id format"}), 400


@bp.post("/clock-in-face")
def clock_in_face():
    """
    Clock in using face recognition.
    
    Request JSON:
    {
        "face_descriptor": [0.123, -0.456, ...],
        "face_image": "data:image/jpeg;base64,...",
        "store_id": "Lawrence"
    }
    """
    try:
        data = request.get_json()
        
        face_descriptor = data.get("face_descriptor")
        face_image = data.get("face_image")
        store_id = data.get("store_id")
        
        if not face_descriptor:
            return jsonify({"error": "face_descriptor is required"}), 400
        
        # Note: store_id is optional now since employees are not tied to stores
        
        # Validate face descriptor
        if not validate_face_descriptor(face_descriptor):
            return jsonify({"error": "Invalid face descriptor format"}), 400
        
        # Get all employees with registered faces (not filtered by store anymore)
        employees = get_collection("employees")
        registered_employees = list(employees.find({
            "face_registered": True
        }))
        
        if not registered_employees:
            return jsonify({
                "success": False,
                "error": "No employees with registered faces found. Please register your face first."
            }), 404
        
        # Find best match
        match = find_best_match(face_descriptor, registered_employees, threshold=0.6)
        
        if not match:
            return jsonify({
                "success": False,
                "error": "Face not recognized. Please try again or contact your manager."
            }), 404
        
        employee_id = match["employee_id"]
        employee_name = match["employee_name"]
        confidence = match["confidence"]
        
        # Automatically learn/update face descriptor if recognition is successful
        # This helps adapt to appearance changes without manual re-registration
        employee_doc = employees.find_one({"_id": ObjectId(employee_id)})
        
        if employee_doc:
            # Get existing descriptors
            existing_descriptors = []
            if 'face_descriptors' in employee_doc and isinstance(employee_doc['face_descriptors'], list):
                existing_descriptors = employee_doc['face_descriptors']
            elif 'face_descriptor' in employee_doc:
                existing_descriptors = [employee_doc['face_descriptor']]
            
            # Check if this new face is different enough from existing ones
            min_distance = float('inf')
            for existing_desc in existing_descriptors:
                distance = euclidean_distance(face_descriptor, existing_desc)
                if distance < min_distance:
                    min_distance = distance
            
            # If distance > 0.3, it's a different appearance - add it to learn
            # Only learn if confidence is high (> 0.7) to avoid learning incorrect faces
            if min_distance > 0.3 and confidence > 0.7:
                existing_descriptors.append(face_descriptor)
                # Limit to last 5 registrations to avoid unlimited growth
                if len(existing_descriptors) > 5:
                    existing_descriptors = existing_descriptors[-5:]
                
                employees.update_one(
                    {"_id": ObjectId(employee_id)},
                    {"$set": {"face_descriptors": existing_descriptors}}
                )
        
        # Check if employee is already clocked in today
        timeclock = get_collection("timeclock")
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        
        existing_entry = timeclock.find_one({
            "employee_id": employee_id,
            "clock_in": {"$gte": today_start},
            "clock_out": None
        })
        
        if existing_entry:
            # Ensure UTC timezone indicator is included
            clock_in_iso = existing_entry["clock_in"].isoformat()
            if not clock_in_iso.endswith('Z') and existing_entry["clock_in"].tzinfo is None:
                clock_in_iso += 'Z'
            
            return jsonify({
                "success": False,
                "error": f"{employee_name} is already clocked in today.",
                "employee_name": employee_name,
                "clock_in_time": clock_in_iso
            }), 400
        
        # Compress face image
        compressed_image = compress_image(face_image, max_size=400) if face_image else None
        
        # Create clock-in entry
        doc = {
            "employee_id": employee_id,
            "employee_name": employee_name,
            "store_id": store_id,
            "clock_in": datetime.utcnow(),
            "clock_out": None,
            "clock_in_face_image": compressed_image,
            "clock_in_confidence": confidence
        }
        
        result = timeclock.insert_one(doc)
        
        # Ensure UTC timezone indicator is included
        clock_in_iso = doc["clock_in"].isoformat()
        if not clock_in_iso.endswith('Z') and doc["clock_in"].tzinfo is None:
            clock_in_iso += 'Z'
        
        return jsonify({
            "success": True,
            "entry_id": str(result.inserted_id),
            "employee_id": employee_id,
            "employee_name": employee_name,
            "clock_in_time": clock_in_iso,
            "confidence": confidence
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.post("/clock-out-face")
def clock_out_face():
    """
    Clock out using face recognition.
    
    Request JSON:
    {
        "face_descriptor": [0.123, -0.456, ...],
        "face_image": "data:image/jpeg;base64,...",
        "store_id": "Lawrence"
    }
    """
    try:
        data = request.get_json()
        
        face_descriptor = data.get("face_descriptor")
        face_image = data.get("face_image")
        store_id = data.get("store_id")
        
        if not face_descriptor:
            return jsonify({"error": "face_descriptor is required"}), 400
        
        # Note: store_id is optional now since employees are not tied to stores
        
        # Validate face descriptor
        if not validate_face_descriptor(face_descriptor):
            return jsonify({"error": "Invalid face descriptor format"}), 400
        
        # Get all employees with registered faces (not filtered by store anymore)
        employees = get_collection("employees")
        registered_employees = list(employees.find({
            "face_registered": True
        }))
        
        if not registered_employees:
            return jsonify({
                "success": False,
                "error": "No employees with registered faces found."
            }), 404
        
        # Find best match
        match = find_best_match(face_descriptor, registered_employees, threshold=0.6)
        
        if not match:
            return jsonify({
                "success": False,
                "error": "Face not recognized. Please try again or contact your manager."
            }), 404
        
        employee_id = match["employee_id"]
        employee_name = match["employee_name"]
        confidence = match["confidence"]
        
        # Automatically learn/update face descriptor if recognition is successful
        employee_doc = employees.find_one({"_id": ObjectId(employee_id)})
        
        if employee_doc:
            # Get existing descriptors
            existing_descriptors = []
            if 'face_descriptors' in employee_doc and isinstance(employee_doc['face_descriptors'], list):
                existing_descriptors = employee_doc['face_descriptors']
            elif 'face_descriptor' in employee_doc:
                existing_descriptors = [employee_doc['face_descriptor']]
            
            # Check if this new face is different enough from existing ones
            min_distance = float('inf')
            for existing_desc in existing_descriptors:
                distance = euclidean_distance(face_descriptor, existing_desc)
                if distance < min_distance:
                    min_distance = distance
            
            # If distance > 0.3, it's a different appearance - add it to learn
            # Only learn if confidence is high (> 0.7) to avoid learning incorrect faces
            if min_distance > 0.3 and confidence > 0.7:
                existing_descriptors.append(face_descriptor)
                # Limit to last 5 registrations to avoid unlimited growth
                if len(existing_descriptors) > 5:
                    existing_descriptors = existing_descriptors[-5:]
                
                employees.update_one(
                    {"_id": ObjectId(employee_id)},
                    {"$set": {"face_descriptors": existing_descriptors}}
                )
        
        # Find active clock-in entry for today
        timeclock = get_collection("timeclock")
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        
        active_entry = timeclock.find_one({
            "employee_id": employee_id,
            "clock_in": {"$gte": today_start},
            "clock_out": None
        })
        
        if not active_entry:
            return jsonify({
                "success": False,
                "error": f"{employee_name} is not clocked in today. Please clock in first.",
                "employee_name": employee_name
            }), 400
        
        # Compress face image
        compressed_image = compress_image(face_image, max_size=400) if face_image else None
        
        # Update entry with clock-out time
        clock_out_time = datetime.utcnow()
        clock_in_time = active_entry["clock_in"]
        hours_worked = (clock_out_time - clock_in_time).total_seconds() / 3600
        
        update_data = {
            "clock_out": clock_out_time,
            "clock_out_face_image": compressed_image,
            "clock_out_confidence": confidence,
            "hours_worked": round(hours_worked, 2)
        }
        
        timeclock.update_one(
            {"_id": active_entry["_id"]},
            {"$set": update_data}
        )
        
        # Ensure UTC timezone indicator is included
        clock_in_iso = clock_in_time.isoformat()
        if not clock_in_iso.endswith('Z') and clock_in_time.tzinfo is None:
            clock_in_iso += 'Z'
        
        clock_out_iso = clock_out_time.isoformat()
        if not clock_out_iso.endswith('Z') and clock_out_time.tzinfo is None:
            clock_out_iso += 'Z'
        
        return jsonify({
            "success": True,
            "entry_id": str(active_entry["_id"]),
            "employee_id": employee_id,
            "employee_name": employee_name,
            "clock_in_time": clock_in_iso,
            "clock_out_time": clock_out_iso,
            "hours_worked": round(hours_worked, 2),
            "confidence": confidence
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/today")
def get_today_entries():
    """
    Get all timeclock entries for today for a specific store.
    
    Query params:
    - store_id: Store identifier
    """
    try:
        store_id = request.args.get("store_id")
        
        if not store_id:
            return jsonify({"error": "store_id is required"}), 400
        
        timeclock = get_collection("timeclock")
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_start = today_start + timedelta(days=1)
        
        entries = list(timeclock.find({
            "store_id": store_id,
            "clock_in": {
                "$gte": today_start,
                "$lt": tomorrow_start
            }
        }).sort("clock_in", -1))
        
        # Format entries for response
        formatted_entries = []
        for entry in entries:
            # Ensure UTC timezone indicator is included
            clock_in_iso = entry["clock_in"].isoformat()
            if not clock_in_iso.endswith('Z') and entry["clock_in"].tzinfo is None:
                clock_in_iso += 'Z'
            
            clock_out_iso = None
            if entry.get("clock_out"):
                clock_out_iso = entry["clock_out"].isoformat()
                if not clock_out_iso.endswith('Z') and entry["clock_out"].tzinfo is None:
                    clock_out_iso += 'Z'
            
            formatted_entry = {
                "entry_id": str(entry["_id"]),
                "employee_id": entry.get("employee_id"),
                "employee_name": entry.get("employee_name", "Unknown"),
                "store_id": entry.get("store_id"),
                "clock_in": clock_in_iso,
                "clock_out": clock_out_iso,
                "hours_worked": entry.get("hours_worked"),
                "status": "clocked_out" if entry.get("clock_out") else "clocked_in",
                "clock_in_confidence": entry.get("clock_in_confidence"),
                "clock_out_confidence": entry.get("clock_out_confidence")
            }
            formatted_entries.append(formatted_entry)
        
        return jsonify({
            "date": today_start.date().isoformat(),
            "store_id": store_id,
            "employees": formatted_entries,
            "total_count": len(formatted_entries)
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/history")
def get_history():
    """
    Get timeclock history for a store.
    
    Query params:
    - store_id: Store identifier
    - days: Number of days to look back (default 30)
    """
    try:
        store_id = request.args.get("store_id")
        days = int(request.args.get("days", 30))
        
        if not store_id:
            return jsonify({"error": "store_id is required"}), 400
        
        timeclock = get_collection("timeclock")
        start_date = datetime.utcnow() - timedelta(days=days)
        
        entries = list(timeclock.find({
            "store_id": store_id,
            "clock_in": {"$gte": start_date}
        }).sort("clock_in", -1))
        
        # Format entries for response
        formatted_entries = []
        for entry in entries:
            # Ensure UTC timezone indicator is included
            clock_in_iso = entry["clock_in"].isoformat()
            if not clock_in_iso.endswith('Z') and entry["clock_in"].tzinfo is None:
                clock_in_iso += 'Z'
            
            clock_out_iso = None
            if entry.get("clock_out"):
                clock_out_iso = entry["clock_out"].isoformat()
                if not clock_out_iso.endswith('Z') and entry["clock_out"].tzinfo is None:
                    clock_out_iso += 'Z'
            
            formatted_entry = {
                "entry_id": str(entry["_id"]),
                "employee_id": entry.get("employee_id"),
                "employee_name": entry.get("employee_name", "Unknown"),
                "clock_in": clock_in_iso,
                "clock_out": clock_out_iso,
                "hours_worked": entry.get("hours_worked"),
                "status": "clocked_out" if entry.get("clock_out") else "clocked_in"
            }
            formatted_entries.append(formatted_entry)
        
        return jsonify({
            "store_id": store_id,
            "entries": formatted_entries,
            "total_count": len(formatted_entries),
            "days": days
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/employee/<employee_id>/history")
def get_employee_history(employee_id):
    """
    Get timeclock history for a specific employee.
    
    Path params:
    - employee_id: Employee identifier
    
    Query params:
    - days: Number of days to look back (default 90)
    """
    try:
        days = int(request.args.get("days", 90))
        
        timeclock = get_collection("timeclock")
        start_date = datetime.utcnow() - timedelta(days=days)
        
        # Find all entries for this employee
        entries = list(timeclock.find({
            "employee_id": employee_id,
            "clock_in": {"$gte": start_date}
        }).sort("clock_in", -1))
        
        # Format entries for response
        formatted_entries = []
        for entry in entries:
            # Ensure UTC timezone indicator is included
            clock_in_iso = entry["clock_in"].isoformat()
            if not clock_in_iso.endswith('Z') and entry["clock_in"].tzinfo is None:
                clock_in_iso += 'Z'
            
            clock_out_iso = None
            if entry.get("clock_out"):
                clock_out_iso = entry["clock_out"].isoformat()
                if not clock_out_iso.endswith('Z') and entry["clock_out"].tzinfo is None:
                    clock_out_iso += 'Z'
            
            formatted_entry = {
                "entry_id": str(entry["_id"]),
                "employee_id": entry.get("employee_id"),
                "employee_name": entry.get("employee_name", "Unknown"),
                "store_id": entry.get("store_id"),
                "clock_in": clock_in_iso,
                "clock_out": clock_out_iso,
                "hours_worked": entry.get("hours_worked"),
                "status": "clocked_out" if entry.get("clock_out") else "clocked_in",
                "clock_in_confidence": entry.get("clock_in_confidence"),
                "clock_out_confidence": entry.get("clock_out_confidence")
            }
            formatted_entries.append(formatted_entry)
        
        return jsonify({
            "employee_id": employee_id,
            "entries": formatted_entries,
            "total_count": len(formatted_entries),
            "days": days
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500
