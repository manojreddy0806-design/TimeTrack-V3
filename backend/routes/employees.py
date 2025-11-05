# backend/routes/employees.py
from flask import Blueprint, request, jsonify
from ..models import get_employees, create_employee, delete_employee

bp = Blueprint("employees", __name__)

@bp.get("/")
def list_employees():
    store_id = request.args.get("store_id")
    employees = get_employees(store_id)
    return jsonify(employees)

@bp.post("/")
def add_employee():
    data = request.get_json()
    emp_id = create_employee(
        store_id=data.get("store_id"),
        name=data.get("name"),
        role=data.get("role"),
        phone_number=data.get("phone_number"),
        hourly_pay=data.get("hourly_pay")
    )
    return jsonify({"id": emp_id}), 201

@bp.delete("/<employee_id>")
def remove_employee(employee_id):
    success = delete_employee(employee_id)
    if success:
        return jsonify({"success": True, "message": "Employee deleted successfully"}), 200
    else:
        return jsonify({"success": False, "error": "Employee not found"}), 404
