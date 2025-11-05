# backend/models.py
from datetime import datetime
from flask import current_app
import bcrypt

# MongoDB uses dynamic collections — no ORM class needed.
# These helper functions wrap PyMongo for easy use.

def get_collection(name):
    """Helper to get a MongoDB collection from current Flask app context."""
    # Import mongo instance
    from .app import mongo
    
    # Try accessing db property first (Flask-PyMongo's standard way)
    db = mongo.db
    if db is not None:
        return db[name]
    
    # If db is None, Flask-PyMongo might not have initialized properly
    # Get MONGO_URI from config
    mongo_uri = current_app.config.get('MONGO_URI', 'mongodb://localhost:27017/timetrack')
    
    # Try accessing via client attribute (alternative name in some versions)
    client = None
    if hasattr(mongo, 'cx') and mongo.cx is not None:
        client = mongo.cx
    elif hasattr(mongo, 'client') and mongo.client is not None:
        client = mongo.client
    
    if client is None:
        # Last resort: create our own MongoClient using the URI from config
        from pymongo import MongoClient
        client = MongoClient(mongo_uri)
    
    # Extract database name from MONGO_URI
    parts = mongo_uri.rsplit('/', 1)
    if len(parts) == 2 and parts[1]:
        db_name = parts[1].split('?')[0]  # Remove query params
    else:
        db_name = 'timetrack'
    
    db = client[db_name]
    return db[name]

# ---------- STORES ----------
def get_default_inventory_items():
    """Returns a list of default inventory items that should be created for each new store"""
    return [
  {"sku": "Samsung", "name": "S 23 FE"},
  {"sku": "Samsung", "name": "S24 FE"},
  {"sku": "Samsung", "name": "Samsung Tab 3"},
  {"sku": "Samsung", "name": "Samsung Watch"},
  
  {"sku": "Apple", "name": "Iphone 13"},
  {"sku": "Apple", "name": "Iphone 14"},
  {"sku": "Apple", "name": "Iphone 16"},
  {"sku": "Apple", "name": "Iphone 16 e"},
  {"sku": "Apple", "name": "Iphone 16 plus"},
  {"sku": "Apple", "name": "Iphone 16 pro"},
  {"sku": "Apple", "name": "Iphone 16 pro max"},
  {"sku": "Apple", "name": "Apple Watch"},
  
  {"sku": "Motorola", "name": "Moto g 2024"},
  {"sku": "Motorola", "name": "Moto g 2025"},
  {"sku": "Motorola", "name": "Moto power 2024"},
  {"sku": "Motorola", "name": "Moto power 2025"},
  {"sku": "Motorola", "name": "Moto razr 2024"},
  {"sku": "Motorola", "name": "Moto stylus 2023"},
  {"sku": "Motorola", "name": "Moto stylus 2024"},
  {"sku": "Motorola", "name": "Moto stylus 2025"},
  {"sku": "Motorola", "name": "Moto edge 2024"},
  
  {"sku": "TCL", "name": "TCL 50 XL 3"},
  {"sku": "TCL", "name": "TCL K32"},
  {"sku": "TCL", "name": "TCL ION X"},
  {"sku": "TCL", "name": "TCL K11"},
  {"sku": "TCL", "name": "TCL Tab"},
  
  {"sku": "Revvl", "name": "Rewl 7"},
  {"sku": "Revvl", "name": "Rewl 7 pro"},
  {"sku": "Revvl", "name": "Revvl Tab"},
  {"sku": "Revvl", "name": "Revll 8"},
  
  {"sku": "Google", "name": "Google pixel"},
  {"sku": "Chromebook", "name": "Chrome book"},
  {"sku": "Flip Phone", "name": "Flip Phone 3"},
  
  {"sku": "Generic", "name": "A13"},
  {"sku": "Generic", "name": "A15"},
  {"sku": "Generic", "name": "A16"},
  {"sku": "Generic", "name": "A35"},
  {"sku": "Generic", "name": "A36"},
  {"sku": "Generic", "name": "C210"},
  {"sku": "Generic", "name": "G310"},
  {"sku": "Generic", "name": "G400"},
  {"sku": "Generic", "name": "HSI"},
  {"sku": "Simcards", "name": "Simcards"},
]


def hash_password(password):
    """Hash a password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password, hashed):
    """Verify a password against a hash. Handles both hashed and plain text (for backward compatibility)"""
    try:
        # Try to verify as bcrypt hash
        if hashed.startswith('$2b$') or hashed.startswith('$2a$'):
            return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except:
        pass
    # Fallback: plain text comparison (for backward compatibility with existing stores)
    return password == hashed

def create_store(name, username=None, password=None, total_boxes=0):
    stores = get_collection("stores")
    # Generate default username (store name lowercase) if not provided
    if username is None:
        username = name.lower().replace(" ", "")
    # Generate default password if not provided
    if password is None:
        password = username + "123"  # Simple default password
    
    # Hash the password before storing
    password_hash = hash_password(password)
    
    doc = {
        "name": name, 
        "username": username, 
        "password": password_hash, 
        "total_boxes": total_boxes,
        "yubikey_ids": []  # List of YubiKey public IDs allowed to login
    }
    result = stores.insert_one(doc)
    store_id = str(result.inserted_id)
    
    # Create default inventory items for this store
    inventory = get_collection("inventory")
    default_items = get_default_inventory_items()
    for item in default_items:
        inventory.insert_one({
            "store_id": name,  # Use store name as store_id
            "sku": item["sku"],
            "name": item["name"],
            "quantity": 0
        })
    
    return store_id

def get_store_by_username(username):
    stores = get_collection("stores")
    store = stores.find_one({"username": username}, {"_id": 0})
    return store if store else None

def get_stores():
    stores = get_collection("stores")
    return list(stores.find({}, {"_id": 0}))  # hide _id for cleaner frontend use

def verify_yubikey_otp(otp):
    """
    Verify a YubiKey OTP using YubiCloud API.
    YubiKey OTP is 44 characters: first 12 are public ID, last 32 are OTP.
    Returns tuple: (is_valid: bool, public_id: str or None)
    """
    import requests
    import re
    
    if not otp or len(otp) != 44:
        return False, None
    
    # Extract public ID (first 12 characters)
    public_id = otp[:12]
    
    # Validate format (YubiKey public IDs are typically hex/modhex)
    if not re.match(r'^[cbdefghijklnrtuv]{12}$', public_id):
        return False, None
    
    try:
        # Verify OTP with YubiCloud
        # Use multiple YubiCloud servers for redundancy
        servers = [
            'https://api.yubico.com/wsapi/2.0/verify',
            'https://api2.yubico.com/wsapi/2.0/verify',
            'https://api3.yubico.com/wsapi/2.0/verify',
            'https://api4.yubico.com/wsapi/2.0/verify',
            'https://api5.yubico.com/wsapi/2.0/verify'
        ]
        
        for server in servers:
            try:
                response = requests.get(server, params={'id': '1', 'otp': otp, 'nonce': 'timetrack'}, timeout=3)
                if response.status_code == 200:
                    # Check if OTP is valid
                    if 'status=OK' in response.text and f'otp={otp}' in response.text:
                        return True, public_id
            except:
                continue
        
        return False, None
    except Exception as e:
        # If verification fails, log but don't expose error
        print(f"YubiKey verification error: {e}")
        return False, None

def add_yubikey(store_name, yubikey_id, yubikey_name=None):
    """
    Add an authorized YubiKey to a store.
    yubikey_id should be the 12-character public ID.
    Returns True if successful, False otherwise.
    """
    stores = get_collection("stores")
    store = stores.find_one({"name": store_name})
    if not store:
        return False
    
    # Validate YubiKey ID format (12 characters, modhex)
    import re
    if not yubikey_id or len(yubikey_id) != 12 or not re.match(r'^[cbdefghijklnrtuv]{12}$', yubikey_id):
        return False
    
    yubikey_ids = store.get("yubikey_ids", [])
    # Check if YubiKey already exists
    if any(key.get("yubikey_id") == yubikey_id for key in yubikey_ids):
        return True  # Already authorized
    
    yubikey_ids.append({
        "yubikey_id": yubikey_id,
        "yubikey_name": yubikey_name or "YubiKey",
        "added_at": datetime.utcnow().isoformat()
    })
    
    result = stores.update_one(
        {"name": store_name},
        {"$set": {"yubikey_ids": yubikey_ids}}
    )
    return result.modified_count > 0

def remove_yubikey(store_name, yubikey_id):
    """
    Remove an authorized YubiKey from a store.
    Returns True if successful, False otherwise.
    """
    stores = get_collection("stores")
    store = stores.find_one({"name": store_name})
    if not store:
        return False
    
    yubikey_ids = store.get("yubikey_ids", [])
    yubikey_ids = [key for key in yubikey_ids if key.get("yubikey_id") != yubikey_id]
    
    result = stores.update_one(
        {"name": store_name},
        {"$set": {"yubikey_ids": yubikey_ids}}
    )
    return result.modified_count > 0

def is_yubikey_authorized(store_name, yubikey_id):
    """
    Check if a YubiKey public ID is authorized for a store.
    Returns True if authorized, False otherwise.
    If no YubiKeys are registered, returns False (login blocked).
    """
    stores = get_collection("stores")
    store = stores.find_one({"name": store_name})
    if not store:
        return False
    
    yubikey_ids = store.get("yubikey_ids", [])
    
    # If no YubiKeys are registered, block all logins
    if len(yubikey_ids) == 0:
        return False
    
    # Check if YubiKey is in the authorized list
    return any(key.get("yubikey_id") == yubikey_id for key in yubikey_ids)

def update_store(name, new_name=None, username=None, password=None, total_boxes=None):
    """
    Update a store's information.
    Returns True if update was successful, False otherwise.
    """
    stores = get_collection("stores")
    update_data = {}
    
    if new_name is not None:
        update_data["name"] = new_name
    if username is not None:
        update_data["username"] = username
    if password is not None:
        # Hash the password before storing
        update_data["password"] = hash_password(password)
    if total_boxes is not None:
        update_data["total_boxes"] = total_boxes
    
    if not update_data:
        return False
    
    result = stores.update_one({"name": name}, {"$set": update_data})
    
    # If the store name changed, update all related data that uses store_id
    if new_name and new_name != name:
        old_store_name = name
        new_store_name = new_name
        
        # Update inventory items
        inventory = get_collection("inventory")
        inventory.update_many({"store_id": old_store_name}, {"$set": {"store_id": new_store_name}})
        
        # Update inventory history
        inventory_history = get_collection("inventory_history")
        inventory_history.update_many({"store_id": old_store_name}, {"$set": {"store_id": new_store_name}})
        
        # Update EOD reports
        eod = get_collection("eod")
        eod.update_many({"store_id": old_store_name}, {"$set": {"store_id": new_store_name}})
        
        # Update timeclock entries
        timeclock = get_collection("timeclock")
        timeclock.update_many({"store_id": old_store_name}, {"$set": {"store_id": new_store_name}})
    
    return result.modified_count > 0

def delete_store(name):
    """
    Delete a store and all related data:
    - Store record
    - Inventory items
    - Inventory history snapshots
    - EOD reports
    - Timeclock entries (if they have store_id)
    
    Note: Employees are NOT deleted as they are not tied to a specific store.
    Employees must be deleted explicitly via the Remove Employee button.
    """
    stores = get_collection("stores")
    
    # Delete all related data first
    store_name = name  # Store name is used as store_id
    
    # Delete inventory items for this store
    inventory = get_collection("inventory")
    inventory.delete_many({"store_id": store_name})
    
    # Delete inventory history snapshots for this store
    inventory_history = get_collection("inventory_history")
    inventory_history.delete_many({"store_id": store_name})
    
    # Delete EOD reports for this store
    eod = get_collection("eod")
    eod.delete_many({"store_id": store_name})
    
    # Delete timeclock entries for this store
    timeclock = get_collection("timeclock")
    timeclock.delete_many({"store_id": store_name})
    
    # Finally, delete the store itself
    result = stores.delete_one({"name": name})
    return result.deleted_count > 0

# ---------- EMPLOYEES ----------
def create_employee(store_id, name, role=None, phone_number=None, hourly_pay=None):
    employees = get_collection("employees")
    doc = {
        "store_id": store_id, 
        "name": name, 
        "role": role, 
        "phone_number": phone_number,
        "hourly_pay": hourly_pay,
        "active": True
    }
    result = employees.insert_one(doc)
    return str(result.inserted_id)

def get_employees(store_id=None):
    employees = get_collection("employees")
    query = {"store_id": store_id} if store_id else {}
    results = list(employees.find(query))
    # Convert _id to employee_id string for frontend
    for result in results:
        if "_id" in result:
            result["employee_id"] = str(result["_id"])
            del result["_id"]
    return results

def delete_employee(employee_id):
    from bson import ObjectId
    employees = get_collection("employees")
    if not employee_id:
        return False
    try:
        result = employees.delete_one({"_id": ObjectId(employee_id)})
        return result.deleted_count > 0
    except (ValueError, TypeError):
        return False
    except Exception:
        return False

# ---------- INVENTORY ----------
def add_inventory_item(store_id, sku, name, quantity=0):
    inventory = get_collection("inventory")
    doc = {"store_id": store_id, "sku": sku, "name": name, "quantity": quantity}
    result = inventory.insert_one(doc)
    return str(result.inserted_id)

def update_inventory_item(store_id, sku=None, item_id=None, quantity=None, name=None, new_sku=None):
    """
    Update an inventory item. Can identify by either item_id (preferred) or store_id+sku.
    If item_id is provided, it takes precedence over sku.
    """
    from bson import ObjectId
    inventory = get_collection("inventory")
    update_data = {}
    if quantity is not None:
        update_data["quantity"] = quantity
    if name is not None:
        update_data["name"] = name
    if new_sku is not None:
        # If SKU is changing, we need to check if new SKU already exists
        query_for_check = {"store_id": store_id, "sku": new_sku}
        if item_id:
            query_for_check["_id"] = {"$ne": ObjectId(item_id)}
        existing = inventory.find_one(query_for_check)
        if existing:
            return False  # New SKU already exists
        # Update SKU
        update_data["sku"] = new_sku
    
    if not update_data:
        return False
    
    # Build query - prefer item_id if provided
    if item_id:
        try:
            query = {"_id": ObjectId(item_id)}
        except:
            return False  # Invalid ObjectId format
    elif store_id and sku:
        query = {"store_id": store_id, "sku": sku}
    else:
        return False  # Need either item_id or both store_id and sku
    
    result = inventory.update_one(query, {"$set": update_data})
    return result.modified_count > 0

def delete_inventory_item(store_id, sku):
    inventory = get_collection("inventory")
    result = inventory.delete_one({"store_id": store_id, "sku": sku})
    return result.deleted_count > 0

def get_inventory(store_id=None):
    inventory = get_collection("inventory")
    query = {"store_id": store_id} if store_id else {}
    results = list(inventory.find(query))
    # Convert _id to string for JSON serialization
    for result in results:
        if "_id" in result:
            result["_id"] = str(result["_id"])
    return results

# ---------- TIME CLOCK ----------
def clock_in(employee_id):
    timeclock = get_collection("timeclock")
    doc = {
        "employee_id": employee_id,
        "clock_in": datetime.utcnow(),
        "clock_out": None
    }
    result = timeclock.insert_one(doc)
    return str(result.inserted_id)

def clock_out(entry_id):
    timeclock = get_collection("timeclock")
    result = timeclock.update_one(
        {"_id": entry_id}, {"$set": {"clock_out": datetime.utcnow()}}
    )
    return result.modified_count > 0

# ---------- EOD REPORT ----------
def create_eod(store_id, report_date, notes=None, cash_amount=0, credit_amount=0, qpay_amount=0, boxes_count=0, total1=0, submitted_by=None):
    eod = get_collection("eod")
    doc = {
        "store_id": store_id,
        "report_date": report_date,
        "notes": notes or "",
        "cash_amount": cash_amount,
        "credit_amount": credit_amount,
        "qpay_amount": qpay_amount,
        "boxes_count": boxes_count,
        "total1": total1,
        "submitted_by": submitted_by or "Unknown",
        "created_at": datetime.utcnow(),
    }
    result = eod.insert_one(doc)
    return str(result.inserted_id)

def get_eods(store_id=None):
    eod = get_collection("eod")
    timeclock = get_collection("timeclock")
    query = {"store_id": store_id} if store_id else {}
    results = list(eod.find(query, {"_id": 0}).sort("report_date", -1))
    
    # Convert datetime objects to ISO format strings for JSON serialization
    # and add employee names who worked that day
    for result in results:
        if "created_at" in result and isinstance(result["created_at"], datetime):
            # Ensure timezone info is included - if naive datetime, assume UTC and add 'Z'
            dt = result["created_at"]
            if dt.tzinfo is None:
                # Naive datetime from utcnow() - append 'Z' to indicate UTC
                result["created_at"] = dt.isoformat() + 'Z'
            else:
                result["created_at"] = dt.isoformat()
        
        # Get employees who worked on this report date
        report_date = result.get("report_date")
        store = result.get("store_id")
        if report_date and store:
            # Parse report_date to get start and end of day
            try:
                from datetime import datetime as dt, timedelta
                report_dt = dt.fromisoformat(report_date.replace('Z', '+00:00')) if isinstance(report_date, str) else report_date
                day_start = report_dt.replace(hour=0, minute=0, second=0, microsecond=0)
                day_end = day_start + timedelta(days=1)
                
                # Find all timeclock entries for this store on this date
                entries = list(timeclock.find({
                    "store_id": store,
                    "clock_in": {"$gte": day_start, "$lt": day_end}
                }))
                
                # Extract unique employee names
                employee_names = list(set([entry.get("employee_name", "Unknown") for entry in entries if entry.get("employee_name")]))
                employee_names.sort()  # Sort alphabetically
                result["employees_worked"] = employee_names
            except Exception as e:
                print(f"Error getting employees for EOD: {e}")
                result["employees_worked"] = []
        else:
            result["employees_worked"] = []
    
    return results
