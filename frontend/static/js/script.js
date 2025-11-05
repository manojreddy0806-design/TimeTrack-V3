// ======== script.js — Flask + MongoDB Connected Version ========

// ---------- Toast Notification System ----------
let toastContainer = null;

function initToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.id = 'toastContainer';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = 'info', title = null) {
  initToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Icons for different types
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  const icon = icons[type] || icons.info;
  const displayTitle = title || (type.charAt(0).toUpperCase() + type.slice(1));
  
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(displayTitle)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;
  
  toastContainer.appendChild(toast);
  
  // Auto-remove after 5 seconds (or 8 seconds for success messages)
  const autoRemoveTime = type === 'success' ? 8000 : 5000;
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('slide-out');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 300);
    }
  }, autoRemoveTime);
  
  return toast;
}

// Convenience functions
function showSuccess(message, title = 'Success') {
  return showToast(message, 'success', title);
}

function showError(message, title = 'Error') {
  return showToast(message, 'error', title);
}

function showWarning(message, title = 'Warning') {
  return showToast(message, 'warning', title);
}

function showInfo(message, title = 'Info') {
  return showToast(message, 'info', title);
}

// ---------- Utility ----------
function qs(id) { return document.getElementById(id); }
function showMessage(el, text, type = "info") {
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = "block";
  setTimeout(() => el.style.display = "none", 3000);
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- YubiKey Helper Functions ----------
// YubiKey OTP is automatically captured when user touches the YubiKey
// The input field will capture the 44-character OTP

// ---------- API Helper ----------
const API_BASE = "/api";

async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path, window.location.origin);
  Object.keys(params).forEach(k => url.searchParams.append(k, params[k]));
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function apiPost(path, data) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const errorText = await res.text();
    try {
      const errorJson = JSON.parse(errorText);
      // Extract error message cleanly
      const errorMessage = errorJson.error || errorJson.message || errorText;
      throw new Error(errorMessage);
    } catch (e) {
      // If it's already an Error object with a clean message, rethrow it
      if (e instanceof Error && e.message !== errorText) {
        throw e;
      }
      // Otherwise, try to extract message from raw text
      const cleanMessage = errorText.replace(/^\{.*?"error"\s*:\s*"([^"]+)".*\}$/, '$1');
      throw new Error(cleanMessage !== errorText ? cleanMessage : errorText);
    }
  }
  return await res.json();
}

async function apiDelete(path) {
  const res = await fetch(API_BASE + path, {
    method: "DELETE"
  });
  if (!res.ok) {
    const errorText = await res.text();
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.error || errorText);
    } catch (e) {
      throw new Error(errorText);
    }
  }
  return await res.json();
}

// ---------- Session ----------
function saveSession(session) {
  localStorage.setItem("TimeTrack_Session", JSON.stringify(session));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem("TimeTrack_Session")); }
  catch { return null; }
}
function clearSession() {
  localStorage.removeItem("TimeTrack_Session");
}

// ---------- Login ----------
if (qs("loginBtn")) {
  qs("loginBtn").addEventListener("click", async () => {
    const user = qs("username").value.trim();
    const pass = qs("password").value;
    const msg = qs("loginMessage");

    if (!user || !pass)
      return showMessage(msg, "Please enter username and password", "error");

    // Try manager login first (no YubiKey required)
    try {
      const managerResult = await apiPost("/stores/manager/login", { username: user, password: pass });
      if (managerResult && managerResult.role === "manager") {
        saveSession({ role: "manager", name: managerResult.name || "Manager" });
        window.location = "manager.html";
        return;
      }
    } catch (managerErr) {
      // Manager login failed (401 or other error), try store login
      // If manager login fails, continue to store login which requires YubiKey
    }

    // Try store login
    try {
      const yubikeyOtpInput = qs("yubikeyOtp");
      const yubikeyOtp = yubikeyOtpInput ? yubikeyOtpInput.value.trim() : "";
      
      if (!yubikeyOtp) {
        showMessage(msg, "Please touch your YubiKey to generate an OTP", "error");
        if (yubikeyOtpInput) yubikeyOtpInput.focus();
        return;
      }
      
      const result = await apiPost("/stores/login", { 
        username: user, 
        password: pass,
        yubikey_otp: yubikeyOtp
      });
      if (result && result.name) {
        saveSession({ 
          role: "store", 
          storeId: result.name, 
          storeName: result.name
        });
        window.location = "dashboard.html";
      } else {
        showMessage(msg, "Invalid credentials", "error");
      }
    } catch (err) {
      // Extract clean error message from various formats
      let errorMessage = "Invalid credentials";
      
      if (err.message) {
        errorMessage = err.message;
        
        // Try to parse if it's a JSON string
        try {
          const parsed = JSON.parse(errorMessage);
          if (parsed.error) {
            errorMessage = parsed.error;
          }
        } catch (e) {
          // If parsing fails, use the message as-is (it's already clean)
        }
        
        // Remove any JSON formatting if it somehow got through
        errorMessage = errorMessage.replace(/^\{.*?"error"\s*:\s*"([^"]+)".*\}$/, '$1');
        errorMessage = errorMessage.replace(/^\{.*?\}$/, errorMessage);
      }
      
      showMessage(msg, errorMessage, "error");
    }
  });
}

// ---------- Logout ----------
window.logoutApp = function () {
  clearSession();
  window.location = "index.html";
};

// ---------- Inventory ----------
async function loadInventory(storeId) {
  return await apiGet("/inventory/", { store_id: storeId });
}
async function addInventoryItem(storeId, name, sku, quantity) {
  return await apiPost("/inventory/", {
    store_id: storeId, name, sku, quantity
  });
}
async function updateInventoryItem(storeId, sku, quantity, itemId = null) {
  const payload = { store_id: storeId, quantity };
  if (itemId) {
    payload._id = itemId;  // Use _id if available for unique identification
  } else {
    payload.sku = sku;  // Fallback to SKU if _id not available
  }
  const res = await fetch(API_BASE + "/inventory/", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function updateInventoryItemDetails(storeId, oldSku, name, newSku, itemId = null) {
  const payload = { store_id: storeId, name, new_sku: newSku };
  if (itemId) {
    payload._id = itemId;  // Use _id if available for unique identification
  } else {
    payload.sku = oldSku;  // Fallback to SKU if _id not available
  }
  const res = await fetch(API_BASE + "/inventory/", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errorText = await res.text();
    let errorMsg = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMsg = errorJson.error || errorText;
    } catch (e) {
      // Keep original error text
    }
    throw new Error(errorMsg);
  }
  return await res.json();
}
async function deleteInventoryItem(storeId, sku) {
  const res = await fetch(API_BASE + "/inventory/", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_id: storeId, sku })
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
async function createInventorySnapshot(storeId) {
  // Use device's local time, not UTC
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // getMonth() is 0-indexed
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD format in local time
  
  // Also send today's date for comparison
  return await apiPost("/inventory/history/snapshot", {
    store_id: storeId,
    snapshot_date: dateStr,
    today_date: dateStr  // Send today's date from device's local time
  });
}

// ---------- Employees ----------
async function loadEmployees(storeId) {
  return await apiGet("/employees/", { store_id: storeId });
}
async function addEmployee(storeId, name, role) {
  return await apiPost("/employees/", {
    store_id: storeId, name, role
  });
}

// ---------- Timeclock ----------
async function clockIn(employeeId) {
  return await apiPost("/timeclock/clock-in", { employee_id: employeeId });
}
async function clockOut(entryId) {
  return await apiPost("/timeclock/clock-out", { entry_id: entryId });
}

// ---------- EOD ----------
async function submitEod(storeId, reportDate, notes, cashAmount = 0, creditAmount = 0, qpayAmount = 0, boxesCount = 0, total1 = 0, submittedBy = null) {
  return await apiPost("/eod/", {
    store_id: storeId,
    report_date: reportDate,
    notes,
    cash_amount: cashAmount,
    credit_amount: creditAmount,
    qpay_amount: qpayAmount,
    boxes_count: boxesCount,
    total1: total1,
    submitted_by: submittedBy
  });
}
async function loadEods(storeId) {
  return await apiGet("/eod/", { store_id: storeId });
}

// ---------- Stores ----------
async function loadStores() {
  return await apiGet("/stores/");
}
async function addStore(name, total_boxes, username, password) {
  return await apiPost("/stores/", { name, total_boxes, username, password });
}
async function updateStore(name, new_name, total_boxes, username, password) {
  const res = await fetch(API_BASE + "/stores/", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, new_name, total_boxes, username, password })
  });
  if (!res.ok) {
    const errorText = await res.text();
    try {
      const errorJson = JSON.parse(errorText);
      throw new Error(errorJson.error || errorText);
    } catch (e) {
      throw new Error(errorText);
    }
  }
  return await res.json();
}
async function removeStore(name) {
  const res = await fetch(API_BASE + "/stores/", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
async function registerYubikey(storeName, yubikeyOtp, yubikeyName) {
  return await apiPost("/stores/yubikey/register", {
    store_name: storeName,
    yubikey_otp: yubikeyOtp,
    yubikey_name: yubikeyName
  });
}
async function removeYubikey(storeName, yubikeyId) {
  const res = await fetch(API_BASE + "/stores/yubikey/remove", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_name: storeName, yubikey_id: yubikeyId })
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
async function listYubikeys(storeName) {
  return await apiGet("/stores/yubikey/list", { store_name: storeName });
}

// ---------- Modal Functions (Global - Available Everywhere) ----------
// Modal functions for Edit Item
window.openEditItemModal = function(itemId, sku, name) {
  const modal = qs("editItemModal");
  if (modal) {
    modal.classList.add("show");
    const nameInput = qs("editItemName");
    const skuInput = qs("editItemSku");
    const oldSkuInput = qs("editItemOldSku");
    const itemIdInput = qs("editItemId") || document.createElement("input");
    if (!qs("editItemId")) {
      itemIdInput.type = "hidden";
      itemIdInput.id = "editItemId";
      const form = qs("editItemForm");
      if (form) form.appendChild(itemIdInput);
    }
    if (nameInput) nameInput.value = name || "";
    if (skuInput) skuInput.value = sku || "";
    if (oldSkuInput) oldSkuInput.value = sku || "";
    if (itemIdInput) itemIdInput.value = itemId || "";
    if (nameInput) nameInput.focus();
    hideError("editItemError");
  }
};

window.closeEditItemModal = function() {
  const modal = qs("editItemModal");
  if (modal) {
    modal.classList.remove("show");
  }
};

window.submitEditItem = async function() {
      const session = loadSession();
      if (!session?.storeId) {
        showError("Session expired. Please login again.");
        return;
      }
  
  const nameInput = qs("editItemName");
  const skuInput = qs("editItemSku");
  const oldSkuInput = qs("editItemOldSku");
  const itemIdInput = qs("editItemId");
  const errorDiv = qs("editItemError");
  
  if (!nameInput || !skuInput || !oldSkuInput) return;
  
  const name = nameInput.value.trim();
  const newSku = skuInput.value.trim();
  const oldSku = oldSkuInput.value.trim();
  const itemId = itemIdInput ? itemIdInput.value.trim() : null;
  
  if (!name) {
    showError("editItemError", "Item name is required");
    nameInput.focus();
    return;
  }
  
  if (!newSku) {
    showError("editItemError", "SKU is required");
    skuInput.focus();
    return;
  }
  
  if (!oldSku && !itemId) {
    showError("editItemError", "Error: Original SKU or item ID not found");
    return;
  }
  
  hideError("editItemError");
  
  try {
    await updateInventoryItemDetails(session.storeId, oldSku, name, newSku, itemId);
    
    // Close modal
    closeEditItemModal();
    
    // Refresh inventory table
    if (typeof window.renderInventory === 'function') {
      await window.renderInventory();
    } else {
      window.location.reload();
    }
  } catch (e) {
    showError("editItemError", "Failed to update item: " + (e.message || "Unknown error"));
  }
};

// Modal functions for Add Item
window.openAddItemModal = function() {
  console.log("openAddItemModal called");
  const modal = qs("addItemModal");
  console.log("Modal element:", modal);
  if (modal) {
    modal.classList.add("show");
    const nameInput = qs("itemName");
    if (nameInput) {
      nameInput.value = "";
      nameInput.focus();
    }
    const skuInput = qs("itemSku");
    if (skuInput) skuInput.value = "";
    const qtyInput = qs("itemQuantity");
    if (qtyInput) qtyInput.value = "0";
    if (typeof hideError === 'function') {
      hideError("addItemError");
    }
  } else {
    console.error("Modal element with id 'addItemModal' not found!");
  }
};

window.closeAddItemModal = function() {
  const modal = qs("addItemModal");
  if (modal) {
    modal.classList.remove("show");
  }
};

window.submitAddItem = async function() {
      const session = loadSession();
      if (!session?.storeId) {
        showError("Session expired. Please login again.");
        return;
      }
  
  const nameInput = qs("itemName");
  const skuInput = qs("itemSku");
  const qtyInput = qs("itemQuantity");
  const errorDiv = qs("addItemError");
  
  if (!nameInput || !skuInput || !qtyInput) return;
  
  const name = nameInput.value.trim();
  const sku = skuInput.value.trim();
  const quantity = parseInt(qtyInput.value) || 0;
  
  if (!name) {
    showError("addItemError", "Item name is required");
    nameInput.focus();
    return;
  }
  
  if (!sku) {
    showError("addItemError", "SKU is required");
    skuInput.focus();
    return;
  }
  
  hideError("addItemError");
  
  try {
    await addInventoryItem(session.storeId, name, sku, quantity);
    
    // Close modal
    window.closeAddItemModal();
    
    // Refresh inventory table
    if (typeof window.renderInventory === 'function') {
      await window.renderInventory();
    } else {
      window.location.reload();
    }
  } catch (e) {
    showError("addItemError", "Failed to add item: " + (e.message || "Unknown error"));
  }
};

// Modal functions for Add Store
window.openAddStoreModal = function() {
  const modal = qs("addStoreModal");
  if (modal) {
    modal.classList.add("show");
    const nameInput = qs("storeName");
    const boxesInput = qs("storeTotalBoxes");
    const usernameInput = qs("storeUsername");
    const passwordInput = qs("storePassword");
    const confirmPasswordInput = qs("storeConfirmPassword");
    
    if (nameInput) {
      nameInput.value = "";
      nameInput.focus();
    }
    if (boxesInput) boxesInput.value = "";
    if (usernameInput) usernameInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";
    hideError("addStoreError");
  }
};

window.closeAddStoreModal = function() {
  const modal = qs("addStoreModal");
  if (modal) {
    modal.classList.remove("show");
  }
};

window.submitAddStore = async function() {
  const storeNameInput = qs("storeName");
  const boxesInput = qs("storeTotalBoxes");
  const usernameInput = qs("storeUsername");
  const passwordInput = qs("storePassword");
  const confirmPasswordInput = qs("storeConfirmPassword");
  const errorDiv = qs("addStoreError");
  
  if (!storeNameInput || !boxesInput || !usernameInput || !passwordInput || !confirmPasswordInput) return;
  
  const name = storeNameInput.value.trim();
  const totalBoxes = boxesInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  
  // Validation
  if (!name) {
    showError("addStoreError", "Store name is required");
    storeNameInput.focus();
    return;
  }
  
  if (!totalBoxes) {
    showError("addStoreError", "Total boxes is required");
    boxesInput.focus();
    return;
  }
  
  const totalBoxesNum = parseInt(totalBoxes);
  if (isNaN(totalBoxesNum) || totalBoxesNum < 1) {
    showError("addStoreError", "Total boxes must be a positive integer");
    boxesInput.focus();
    return;
  }
  
  if (!username) {
    showError("addStoreError", "Username is required");
    usernameInput.focus();
    return;
  }
  
  if (!password) {
    showError("addStoreError", "Password is required");
    passwordInput.focus();
    return;
  }
  
  if (password !== confirmPassword) {
    showError("addStoreError", "Passwords do not match");
    confirmPasswordInput.focus();
    return;
  }
  
  hideError("addStoreError");
  
  try {
    const result = await addStore(name, totalBoxesNum, username, password);
    
    // Close modal
    closeAddStoreModal();
    
    // Refresh stores list
    const path = window.location.pathname.split("/").pop();
    if (path === "manager.html") {
      if (typeof window.renderStores === 'function') {
        await window.renderStores();
      } else {
        window.location.reload();
      }
    }
    
    showSuccess(`Store "${name}" created successfully!`, "Store Created");
  } catch (e) {
    showError("addStoreError", "Failed to add store: " + (e.message || "Unknown error"));
    console.error("Error adding store:", e);
  }
};

// Modal functions for Edit Store
window.openEditStoreModal = function(storeName, totalBoxes, username) {
  const modal = qs("editStoreModal");
  if (modal) {
    modal.classList.add("show");
    const nameInput = qs("editStoreName");
    const originalNameInput = qs("editStoreOriginalName");
    const boxesInput = qs("editStoreTotalBoxes");
    const usernameInput = qs("editStoreUsername");
    const passwordInput = qs("editStorePassword");
    const confirmPasswordInput = qs("editStoreConfirmPassword");
    
    if (nameInput) {
      nameInput.value = storeName || "";
      nameInput.focus();
    }
    if (originalNameInput) originalNameInput.value = storeName || "";
    if (boxesInput) boxesInput.value = totalBoxes || "";
    if (usernameInput) usernameInput.value = username || "";
    if (passwordInput) passwordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";
    hideError("editStoreError");
  }
};

window.closeEditStoreModal = function() {
  const modal = qs("editStoreModal");
  if (modal) {
    modal.classList.remove("show");
  }
};

window.submitEditStore = async function() {
  const originalNameInput = qs("editStoreOriginalName");
  const nameInput = qs("editStoreName");
  const boxesInput = qs("editStoreTotalBoxes");
  const usernameInput = qs("editStoreUsername");
  const passwordInput = qs("editStorePassword");
  const confirmPasswordInput = qs("editStoreConfirmPassword");
  const errorDiv = qs("editStoreError");
  
  if (!originalNameInput || !nameInput || !boxesInput || !usernameInput || !passwordInput || !confirmPasswordInput) return;
  
  const originalName = originalNameInput.value.trim();
  const newName = nameInput.value.trim();
  const totalBoxes = boxesInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  
  // Validation
  if (!newName) {
    showError("editStoreError", "Store name is required");
    nameInput.focus();
    return;
  }
  
  if (!totalBoxes) {
    showError("editStoreError", "Total boxes is required");
    boxesInput.focus();
    return;
  }
  
  const totalBoxesNum = parseInt(totalBoxes);
  if (isNaN(totalBoxesNum) || totalBoxesNum < 1) {
    showError("editStoreError", "Total boxes must be a positive integer");
    boxesInput.focus();
    return;
  }
  
  if (!username) {
    showError("editStoreError", "Username is required");
    usernameInput.focus();
    return;
  }
  
  if (!password) {
    showError("editStoreError", "Password is required");
    passwordInput.focus();
    return;
  }
  
  if (password !== confirmPassword) {
    showError("editStoreError", "Passwords do not match");
    confirmPasswordInput.focus();
    return;
  }
  
  hideError("editStoreError");
  
  try {
    await updateStore(originalName, newName, totalBoxesNum, username, password);
    
    // Close modal
    closeEditStoreModal();
    
    // Refresh stores list
    const path = window.location.pathname.split("/").pop();
    if (path === "manager.html") {
      if (typeof window.renderStores === 'function') {
        await window.renderStores();
      } else {
        window.location.reload();
      }
    }
    
    showSuccess(`Store "${newName}" updated successfully!`, "Store Updated");
  } catch (e) {
    showError("editStoreError", "Failed to update store: " + (e.message || "Unknown error"));
    console.error("Error updating store:", e);
  }
};

// Helper functions for error display
function showError(elementId, message) {
  const errorDiv = qs(elementId);
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.classList.add("show");
  }
}

function hideError(elementId) {
  const errorDiv = qs(elementId);
  if (errorDiv) {
    errorDiv.textContent = "";
    errorDiv.classList.remove("show");
  }
}

// Close modal when clicking outside
document.addEventListener("click", function(e) {
  if (e.target.classList.contains("modal-overlay")) {
    const modals = document.querySelectorAll(".modal-overlay");
    modals.forEach(modal => modal.classList.remove("show"));
  }
});

// Close modal on Escape key
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    const modals = document.querySelectorAll(".modal-overlay");
    modals.forEach(modal => modal.classList.remove("show"));
  }
});

// ---------- Example Page Hooks ----------
document.addEventListener("DOMContentLoaded", async () => {
  const session = loadSession();
  const path = window.location.pathname.split("/").pop();

  if (["manager.html", "dashboard.html"].includes(path) && !session)
    window.location = "index.html";

  // Dashboard page - Update welcome message with store name
  if (path === "dashboard.html" && session?.role === "store") {
    const dashboardWelcome = qs("dashboardWelcome");
    const dashboardRole = qs("dashboardRole");
    const storeName = session.storeName || session.storeId || "Store";
    if (dashboardWelcome) {
      dashboardWelcome.textContent = `Welcome, ${escapeHtml(storeName)}`;
    }
    
  }

  // Inventory page
  if (path === "inventory.html" && session?.storeId) {
    const inventoryTableBody = qs("inventoryTableBody");
    const addItemBtn = qs("addItemBtn");
    const inventorySearch = qs("inventorySearch");
    const isManager = session?.role === 'manager';
    
    // Hide Add Item button for employees (only managers can add items)
    if (addItemBtn && !isManager) {
      addItemBtn.style.display = 'none';
    }
    
    window.renderInventory = async function() {
      try {
        const items = await loadInventory(session.storeId);
        if (!inventoryTableBody) return;
        
        let displayItems = items;
        
        // Filter by search if search term exists
        if (inventorySearch && inventorySearch.value.trim()) {
          const searchTerm = inventorySearch.value.trim().toLowerCase();
          displayItems = items.filter(item => 
            item.name.toLowerCase().includes(searchTerm) || 
            (item.sku && item.sku.toLowerCase().includes(searchTerm))
          );
        }
        
        inventoryTableBody.innerHTML = "";
        if (displayItems.length === 0) {
          inventoryTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#6c757d;">No inventory items found</td></tr>';
          return;
        }
        
        const isManager = session?.role === 'manager';
        
        // Calculate totals for phones and simcards
        let phonesTotal = 0;
        let simcardsTotal = 0;
        
        displayItems.forEach(item => {
          const qty = item.quantity || 0;
          const nameLower = (item.name || '').toLowerCase();
          const skuLower = (item.sku || '').toLowerCase();
          // Check both name and SKU for simcards
          if (nameLower.includes('sim') || nameLower.includes('simcard') || 
              skuLower.includes('sim') || skuLower.includes('simcard')) {
            simcardsTotal += qty;
          } else {
            phonesTotal += qty;
          }
        });
        
        displayItems.forEach(item => {
          const tr = document.createElement("tr");
          const itemId = item._id || item.id || '';  // Use _id if available
          // For employees: only show Update button. For managers: show all buttons.
          const actionButtons = isManager 
            ? `
              <button class="stage-btn" onclick="handleUpdateInventoryItem('${escapeHtml(itemId)}', '${escapeHtml(item.sku || '')}')">Update</button>
              <button class="stage-btn" onclick="handleEditInventoryItem('${escapeHtml(itemId)}', '${escapeHtml(item.sku || '')}', '${escapeHtml(item.name || '')}')" style="background:#ffc107;color:#000;">Edit</button>
              <button class="stage-btn" onclick="handleRemoveInventoryItem('${escapeHtml(item.sku || '')}', '${escapeHtml(item.name || '')}')" style="background:#dc3545;">Remove</button>
            `
            : `
              <button class="stage-btn" onclick="handleUpdateInventoryItem('${escapeHtml(itemId)}', '${escapeHtml(item.sku || '')}')">Update</button>
            `;
          tr.innerHTML = `
            <td>${escapeHtml(item.name || '')}</td>
            <td>${escapeHtml(item.sku || '')}</td>
            <td>${item.quantity || 0}</td>
            <td><input type="number" class="stage-input" value="${item.quantity || 0}" data-item-id="${escapeHtml(itemId)}" data-item-sku="${escapeHtml(item.sku || '')}" data-item-name="${escapeHtml(item.name || '')}" /></td>
            <td style="display:flex;gap:8px;">
              ${actionButtons}
            </td>
          `;
          inventoryTableBody.appendChild(tr);
        });
        
        // Add phones summary row
        const phonesRow = document.createElement("tr");
        phonesRow.className = "special-row";
        phonesRow.style.background = "#fff3cd";
        phonesRow.style.fontWeight = "700";
        phonesRow.innerHTML = `
          <td><strong>phones</strong></td>
          <td>-</td>
          <td><strong>${phonesTotal}</strong></td>
          <td>-</td>
          <td>-</td>
        `;
        inventoryTableBody.appendChild(phonesRow);
        
        // Add simcards summary row
        const simcardsRow = document.createElement("tr");
        simcardsRow.className = "special-row";
        simcardsRow.style.background = "#fff3cd";
        simcardsRow.style.fontWeight = "700";
        simcardsRow.innerHTML = `
          <td><strong>simcard</strong></td>
          <td>-</td>
          <td><strong>${simcardsTotal}</strong></td>
          <td>-</td>
          <td>-</td>
        `;
        inventoryTableBody.appendChild(simcardsRow);
      } catch (e) {
        console.error("Inventory load failed", e);
        if (inventoryTableBody) {
          inventoryTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc3545;">Failed to load inventory</td></tr>';
        }
      }
    }
    
    // Add item button handler
    if (addItemBtn) {
      addItemBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("Add item button clicked");
        if (typeof window.openAddItemModal === 'function') {
          window.openAddItemModal();
        } else {
          console.error("openAddItemModal function not found");
          showError("Modal function not available. Please refresh the page.");
        }
      });
    } else {
      console.error("Add item button not found!");
    }
    
    // Search handler
    if (inventorySearch) {
      inventorySearch.addEventListener("input", () => {
        renderInventory();
      });
    }
    
    // Update inventory item
    window.handleUpdateInventoryItem = async function(itemId, sku) {
      // Try to find input by itemId first, then fallback to sku
      let input = null;
      if (itemId) {
        input = document.querySelector(`input[data-item-id="${itemId}"]`);
      }
      if (!input && sku) {
        input = document.querySelector(`input[data-item-sku="${sku}"]`);
      }
      if (!input) return;
      
      const newQuantity = parseInt(input.value) || 0;
      
      try {
        await updateInventoryItem(session.storeId, sku, newQuantity, itemId);
        await renderInventory();
        showSuccess("Inventory updated successfully!");
      } catch (e) {
        showError("Failed to update inventory: " + (e.message || "Unknown error"));
      }
    };
    
    // Edit inventory item (name and SKU)
    window.handleEditInventoryItem = function(itemId, sku, name) {
      openEditItemModal(itemId, sku, name);
    };
    
    // Remove inventory item
    window.handleRemoveInventoryItem = async function(sku, name) {
      if (!confirm(`Are you sure you want to remove "${name}" (SKU: ${sku})? This action cannot be undone.`)) {
        return;
      }
      
      try {
        await deleteInventoryItem(session.storeId, sku);
        await renderInventory();
        showSuccess("Item removed successfully!");
      } catch (e) {
        showError("Failed to remove item: " + (e.message || "Unknown error"));
      }
    };
    
    renderInventory();
    
    // Submit Inventory button handler
    const submitInventoryBtn = qs("submitInventoryBtn");
    if (submitInventoryBtn) {
      window.submitInventorySnapshot = async function() {
        const session = loadSession();
        if (!session?.storeId) {
          showError("Session expired. Please login again.");
          return;
        }
        
        try {
          await createInventorySnapshot(session.storeId);
          showSuccess("Inventory snapshot submitted successfully!", "Inventory Submitted");
          
          // If we're on the inventory history page, refresh it
          const path = window.location.pathname.split('/').pop();
          if (path === 'store-inventory-history.html' && typeof loadInventoryHistory === 'function') {
            // Small delay to ensure backend has processed the snapshot
            setTimeout(() => {
              loadInventoryHistory();
            }, 500);
          }
        } catch (e) {
          showError("Failed to submit inventory: " + (e.message || "Unknown error"));
        }
      };
    }
  }
  
  // Legacy inventory table (for other pages that might use it)
  if (qs("inventoryTableBody") && session?.storeId && path !== "inventory.html") {
    try {
      const items = await loadInventory(session.storeId);
      const tbody = qs("inventoryTableBody");
      tbody.innerHTML = "";
      items.forEach(it => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${it.name}</td><td>${it.sku}</td><td>${it.quantity}</td>`;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("Inventory load failed", e);
    }
  }

  // Example: EOD submission page
  if (qs("submitEodBtn") && session?.storeId) {
    qs("submitEodBtn").addEventListener("click", async () => {
      // Get values directly from input elements
      const cashAmountInput = qs("cashAmount");
      const creditAmountInput = qs("creditAmount");
      const qpayAmountInput = qs("qpayAmount");
      const boxesCountInput = qs("boxesCount");
      const total1Input = qs("total1");
      const eodNotesInput = qs("eodNotes");
      
      // Extract and parse values - handle empty strings properly
      const dateStr = new Date().toISOString().split("T")[0];
      const notes = eodNotesInput?.value?.trim() || "";
      
      // Helper to safely parse numeric values
      const parseNumber = (value, parser = parseFloat) => {
        if (!value || value.trim() === "") return 0;
        const parsed = parser(value);
        return isNaN(parsed) ? 0 : parsed;
      };
      
      const cashAmount = cashAmountInput ? parseNumber(cashAmountInput.value, parseFloat) : 0;
      const creditAmount = creditAmountInput ? parseNumber(creditAmountInput.value, parseFloat) : 0;
      const qpayAmount = qpayAmountInput ? parseNumber(qpayAmountInput.value, parseFloat) : 0;
      const boxesCount = boxesCountInput ? parseNumber(boxesCountInput.value, parseInt) : 0;
      const total1 = total1Input ? parseNumber(total1Input.value, parseFloat) : 0;
      const submittedBy = session.name || session.storeName || "Unknown";
      
      // Debug logging
      console.log("EOD Submission Values:", {
        cashAmount,
        creditAmount,
        qpayAmount,
        boxesCount,
        total1,
        notes,
        dateStr,
        submittedBy
      });
      
      try {
        const res = await submitEod(session.storeId, dateStr, notes, cashAmount, creditAmount, qpayAmount, boxesCount, total1, submittedBy);
        showSuccess("EOD submitted successfully!", "EOD Submitted");
        // Clear form after successful submission
        if (cashAmountInput) cashAmountInput.value = "";
        if (creditAmountInput) creditAmountInput.value = "";
        if (qpayAmountInput) qpayAmountInput.value = "";
        if (total1Input) total1Input.value = "";
        if (boxesCountInput) boxesCountInput.value = "";
        if (eodNotesInput) eodNotesInput.value = "";
      } catch (e) {
        console.error("EOD submit error:", e);
        showError("EOD submit failed: " + (e.message || "Unknown error"));
      }
    });
  }

  // Manager page - Load and display stores
  if (path === "manager.html" && session?.role === "manager") {
    const managerCards = qs("managerCards");
    
    async function renderStores() {
      try {
        const stores = await loadStores();
        if (!managerCards) return;
        
        if (stores.length === 0) {
          managerCards.innerHTML = '<div class="no-data">No stores found. Click "Add Store" to create one.</div>';
          return;
        }
        
        managerCards.innerHTML = stores.map(store => {
          const escapedName = escapeHtml(store.name);
          const storeId = escapedName;
          const totalBoxes = store.total_boxes || 0;
          const displayName = `${escapedName}-${totalBoxes}`;
          return `
          <div class="simple-store-card" data-store-name="${escapedName}">
            <div class="simple-card-header">
              <h3>${displayName}</h3>
              <div style="display:flex;gap:8px;">
                <button onclick="window.location='store-inventory.html?store=${encodeURIComponent(escapedName)}'" style="background:#007bff;color:white;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;transition:all 0.2s ease;" onmouseover="this.style.background='#0056b3';this.style.transform='translateY(-1px)'" onmouseout="this.style.background='#007bff';this.style.transform='none'">
                  📦 Manage Inventory
                </button>
                <button class="btn-manage-yubikeys-header" data-store-name="${escapedName}" style="background:#17a2b8;color:white;padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;transition:all 0.2s ease;" onmouseover="this.style.background='#138496';this.style.transform='translateY(-1px)'" onmouseout="this.style.background='#17a2b8';this.style.transform='none'">
                  🔑 Manage YubiKeys
                </button>
              </div>
            </div>
            <div class="store-card-details" id="details-${storeId.replace(/\s/g, '-')}">
              <div class="store-card-body">
                <div class="store-section">
                  <div class="store-info-grid">
                    <div class="info-box">
                      <div class="info-box-label">Total Inventory</div>
                      <div class="info-box-value" id="inv-total-${storeId.replace(/\s/g, '-')}">-</div>
                      <div class="info-box-detail" id="inv-count-${storeId.replace(/\s/g, '-')}">Loading...</div>
                    </div>
                    <div class="info-box" style="cursor:pointer;" onclick="window.location='store-inventory-history.html?store=${encodeURIComponent(escapedName)}'" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
                      <div class="info-box-label">Inventory History</div>
                      <div class="info-box-value" id="inv-history-${storeId.replace(/\s/g, '-')}">-</div>
                      <div class="info-box-detail" id="inv-history-detail-${storeId.replace(/\s/g, '-')}">Loading...</div>
                    </div>
                    <div class="info-box success">
                      <div class="info-box-label">Employee Activity</div>
                      <div class="info-box-value" id="emp-active-${storeId.replace(/\s/g, '-')}">-</div>
                      <div class="info-box-detail" id="emp-total-${storeId.replace(/\s/g, '-')}">Loading...</div>
                    </div>
                    <div class="info-box" style="cursor:pointer;" onclick="window.location='store-eod-list.html?store=${encodeURIComponent(escapedName)}'" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">
                      <div class="info-box-label">EOD Reports</div>
                      <div class="info-box-value" id="eod-total-${storeId.replace(/\s/g, '-')}">-</div>
                      <div class="info-box-detail" id="eod-latest-${storeId.replace(/\s/g, '-')}">Loading...</div>
                    </div>
                  </div>
                </div>
                <div class="store-section">
                  <div class="store-section-title">
                    <span class="icon">👥</span> Employees Today
                  </div>
                  <div class="employee-list" id="emp-list-${storeId.replace(/\s/g, '-')}">Loading employees...</div>
                </div>
                <div class="store-section">
                  <div class="store-section-title">
                    <span class="icon">📦</span> Inventory Preview
                  </div>
                  <div class="inventory-grid" id="inv-grid-${storeId.replace(/\s/g, '-')}">Loading inventory...</div>
                </div>
              </div>
            </div>
            <div class="simple-card-actions">
              <button class="manage-store-btn" data-store-name="${escapedName}" onclick="toggleStoreDetails('${escapedName}')">
                <span class="icon">📊</span> Manage Store
              </button>
              <button class="btn-edit-store" data-store-name="${escapedName}" data-store-boxes="${totalBoxes}" data-store-username="${escapeHtml(store.username || '')}" style="background:#ffc107;color:#000;padding:12px 24px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:1rem;transition:all 0.2s ease;margin-left:12px;" onmouseover="this.style.background='#e0a800';this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(255,193,7,0.3)'" onmouseout="this.style.background='#ffc107';this.style.transform='none';this.style.boxShadow='none'">
                Edit Store
              </button>
              <button class="btn-remove-store" data-store-name="${escapedName}" style="background:#dc3545;color:white;padding:12px 24px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:1rem;transition:all 0.2s ease;margin-left:12px;" onmouseover="this.style.background='#c82333';this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(220,53,69,0.3)'" onmouseout="this.style.background='#dc3545';this.style.transform='none';this.style.boxShadow='none'">
                Remove Store
              </button>
            </div>
          </div>
        `;
        }).join("");
        
        // Add event listeners
        managerCards.querySelectorAll('.btn-remove-store').forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const storeName = this.getAttribute('data-store-name');
            handleRemoveStore(storeName);
          });
        });
        
        // Add event listeners for edit store buttons
        managerCards.querySelectorAll('.btn-edit-store').forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const storeName = this.getAttribute('data-store-name');
            const totalBoxes = parseInt(this.getAttribute('data-store-boxes')) || 0;
            const username = this.getAttribute('data-store-username') || '';
            handleEditStore(storeName, totalBoxes, username);
          });
        });
        
        // Add event listeners for manage YubiKeys buttons (in header)
        managerCards.querySelectorAll('.btn-manage-yubikeys-header').forEach(btn => {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const storeName = this.getAttribute('data-store-name');
            handleManageYubikeys(storeName);
          });
        });
        
        // Load store details for all stores
        stores.forEach(store => {
          loadStoreDetails(store.name);
        });
      } catch (e) {
        console.error("Failed to load stores", e);
        if (managerCards) {
          managerCards.innerHTML = '<div class="no-data" style="color:#dc3545;">Failed to load stores. Please refresh.</div>';
        }
      }
    }
    
    window.handleRemoveStore = async function(storeName) {
      if (!confirm(`Are you sure you want to remove the store "${storeName}"? This action cannot be undone.`)) {
        return;
      }
      try {
        await removeStore(storeName);
        await renderStores();
      } catch (e) {
        showError("Failed to remove store: " + (e.message || "Unknown error"));
      }
    };
    
    window.handleAddStore = function() {
      window.openAddStoreModal();
    };
    
    window.handleEditStore = function(storeName, totalBoxes, username) {
      window.openEditStoreModal(storeName, totalBoxes, username);
    };
    
    window.handleManageYubikeys = async function(storeName) {
      window.openManageYubikeysModal(storeName);
    };
    
    // Modal functions for Manage YubiKeys
    window.openManageYubikeysModal = async function(storeName) {
      const modal = qs("manageYubikeysModal");
      if (modal) {
        modal.classList.add("show");
        const storeNameSpan = qs("manageYubikeysStoreName");
        if (storeNameSpan) storeNameSpan.textContent = storeName;
        
        // Clear OTP input
        const otpInput = qs("yubikeyOtpInput");
        if (otpInput) {
          otpInput.value = "";
          // Auto-focus and clear when YubiKey is touched
          otpInput.addEventListener('input', function() {
            // YubiKey OTPs are 44 characters, so when user types/touches, it will auto-fill
            if (this.value.length === 44) {
              // Auto-submit might be too aggressive, so just validate
            }
          });
        }
        
        const nameInput = qs("yubikeyNameInput");
        if (nameInput) nameInput.value = "";
        
        // Load authorized YubiKeys
        await loadAuthorizedYubikeys(storeName);
        hideError("manageYubikeysError");
        
        // Focus OTP input after a short delay
        setTimeout(() => {
          if (otpInput) otpInput.focus();
        }, 300);
      }
    };
    
    window.closeManageYubikeysModal = function() {
      const modal = qs("manageYubikeysModal");
      if (modal) {
        modal.classList.remove("show");
      }
    };
    
    async function loadAuthorizedYubikeys(storeName) {
      const yubikeysList = qs("authorizedYubikeysList");
      if (!yubikeysList) return;
      
      try {
        const result = await listYubikeys(storeName);
        const yubikeys = result.yubikeys || [];
        
        if (yubikeys.length === 0) {
          yubikeysList.innerHTML = '<p style="text-align:center;color:#6c757d;padding:20px;">No YubiKeys registered yet. Register a YubiKey to allow logins.</p>';
          return;
        }
        
        yubikeysList.innerHTML = yubikeys.map((yubikey, index) => {
          const addedDate = yubikey.added_at ? new Date(yubikey.added_at).toLocaleDateString() : 'Unknown';
          return `
            <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;border:1px solid #dee2e6;">
              <div>
                <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(yubikey.yubikey_name || 'YubiKey')}</div>
                <div style="font-size:0.85rem;color:#6c757d;font-family:monospace;">ID: ${escapeHtml(yubikey.yubikey_id)}</div>
                <div style="font-size:0.85rem;color:#6c757d;">Added: ${addedDate}</div>
              </div>
              <button onclick="removeAuthorizedYubikey('${escapeHtml(storeName)}', '${escapeHtml(yubikey.yubikey_id)}')" style="background:#dc3545;color:white;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:0.85rem;font-weight:600;">Remove</button>
            </div>
          `;
        }).join('');
      } catch (e) {
        yubikeysList.innerHTML = '<p style="text-align:center;color:#dc3545;padding:20px;">Failed to load YubiKeys: ' + escapeHtml(e.message) + '</p>';
      }
    }
    
    window.registerCurrentYubikey = async function() {
      const storeNameSpan = qs("manageYubikeysStoreName");
      if (!storeNameSpan) return;
      
      const storeName = storeNameSpan.textContent;
      const otpInput = qs("yubikeyOtpInput");
      const nameInput = qs("yubikeyNameInput");
      
      if (!otpInput) return;
      
      const yubikeyOtp = otpInput.value.trim();
      const yubikeyName = nameInput ? nameInput.value.trim() || "YubiKey" : "YubiKey";
      
      if (!yubikeyOtp) {
        showError("manageYubikeysError", "Please touch your YubiKey to generate an OTP");
        if (otpInput) otpInput.focus();
        return;
      }
      
      if (yubikeyOtp.length !== 44) {
        showError("manageYubikeysError", "Invalid YubiKey OTP. Please touch your YubiKey again.");
        if (otpInput) {
          otpInput.value = "";
          otpInput.focus();
        }
        return;
      }
      
      try {
        await registerYubikey(storeName, yubikeyOtp, yubikeyName);
        showSuccess("YubiKey registered successfully!", "YubiKey Registered");
        if (otpInput) otpInput.value = "";
        if (nameInput) nameInput.value = "";
        await loadAuthorizedYubikeys(storeName);
      } catch (e) {
        showError("manageYubikeysError", "Failed to register YubiKey: " + (e.message || "Unknown error"));
        if (otpInput) {
          otpInput.value = "";
          otpInput.focus();
        }
      }
    };
    
    window.removeAuthorizedYubikey = async function(storeName, yubikeyId) {
      if (!confirm("Are you sure you want to remove this YubiKey? Employees will no longer be able to login with this YubiKey.")) {
        return;
      }
      
      try {
        await removeYubikey(storeName, yubikeyId);
        showSuccess("YubiKey removed successfully!", "YubiKey Removed");
        await loadAuthorizedYubikeys(storeName);
      } catch (e) {
        showError("manageYubikeysError", "Failed to remove YubiKey: " + (e.message || "Unknown error"));
      }
    };
    
    // Note: Modal functions are defined globally at the top of the file
    // No need to redefine them here
    
    // Toggle store details expand/collapse
    window.toggleStoreDetails = function(storeName) {
      const card = document.querySelector(`[data-store-name="${storeName}"]`);
      if (!card) return;
      
      const details = card.querySelector('.store-card-details');
      const btn = card.querySelector('.manage-store-btn');
      
      if (details.classList.contains('expanded')) {
        details.classList.remove('expanded');
        btn.innerHTML = '<span class="icon">📊</span> Manage Store';
      } else {
        details.classList.add('expanded');
        btn.innerHTML = '<span class="icon">👁️</span> Hide Details';
        // Load details if not already loaded
        loadStoreDetails(storeName);
      }
    };
    
    // Load store details (employees, inventory, EOD)
    async function loadStoreDetails(storeName) {
      const storeId = storeName;
      const safeId = storeId.replace(/\s/g, '-');
      
      try {
        // Load employees who clocked in today
        try {
          const todayData = await apiGet('/timeclock/today', { store_id: storeId });
          const employees = todayData.employees || [];
          const empList = qs(`emp-list-${safeId}`);
          
          if (empList) {
            if (employees.length === 0) {
              empList.innerHTML = '<div class="no-data">No employees clocked in today</div>';
            } else {
              empList.innerHTML = employees.map(emp => {
                const status = emp.status === 'clocked_in' ? 'Active' : 'Clocked Out';
                const statusClass = emp.status === 'clocked_in' ? 'employee-status' : 'employee-status-out';
                const hours = emp.hours_worked ? `${emp.hours_worked.toFixed(2)} hrs` : '';
                return `
                  <div class="employee-item">
                    <div>
                      <div class="employee-name">${escapeHtml(emp.employee_name)}</div>
                      <div class="employee-time">${hours}</div>
                    </div>
                    <span class="${statusClass}">${status}</span>
                  </div>
                `;
              }).join('');
            }
            
            const activeCount = employees.filter(e => e.status === 'clocked_in').length;
            qs(`emp-total-${safeId}`).textContent = `${employees.length} today`;
            qs(`emp-active-${safeId}`).textContent = activeCount;
          }
        } catch (err) {
          console.error('Failed to load today employees:', err);
          const empList = qs(`emp-list-${safeId}`);
          if (empList) {
            empList.innerHTML = '<div class="no-data" style="color:#dc3545;">Failed to load employees</div>';
          }
        }
        
        // Load inventory
        const inventory = await loadInventory(storeId);
        const invGrid = qs(`inv-grid-${safeId}`);
        if (invGrid) {
          if (inventory.length === 0) {
            invGrid.innerHTML = '<div class="no-data">No inventory items</div>';
          } else {
            const topItems = inventory.slice(0, 8);
            invGrid.innerHTML = topItems.map(item => {
              const qty = item.quantity || 0;
              let qtyClass = 'high';
              if (qty === 0) qtyClass = 'low';
              else if (qty <= 3) qtyClass = 'medium';
              return `
                <div class="inventory-item">
                  <div class="inventory-item-name">${escapeHtml(item.name)}</div>
                  <div class="inventory-item-qty ${qtyClass}">${qty}</div>
                </div>
              `;
            }).join('');
          }
          const totalQty = inventory.reduce((sum, item) => sum + (item.quantity || 0), 0);
          
          qs(`inv-total-${safeId}`).textContent = totalQty;
          qs(`inv-count-${safeId}`).textContent = `${inventory.length} items`;
          
          // Load inventory history count
          try {
            const historyData = await apiGet('/inventory/history', { store_id: storeId });
            const historyCount = qs(`inv-history-${safeId}`);
            const historyDetail = qs(`inv-history-detail-${safeId}`);
            if (historyCount && historyDetail) {
              historyCount.textContent = historyData.length;
              if (historyData.length > 0) {
                const latest = historyData[0];
                const date = new Date(latest.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                historyDetail.textContent = `Latest: ${date}`;
              } else {
                historyDetail.textContent = 'No snapshots yet';
              }
            }
          } catch (err) {
            console.error('Failed to load inventory history:', err);
            const historyCount = qs(`inv-history-${safeId}`);
            const historyDetail = qs(`inv-history-detail-${safeId}`);
            if (historyCount) historyCount.textContent = '0';
            if (historyDetail) historyDetail.textContent = 'No history';
          }
        }
        
        // Load EOD reports
        const eods = await loadEods(storeId);
        const eodTotal = qs(`eod-total-${safeId}`);
        const eodLatest = qs(`eod-latest-${safeId}`);
        if (eodTotal && eodLatest) {
          eodTotal.textContent = eods.length;
          if (eods.length > 0) {
            const latest = eods[0];
            const date = new Date(latest.report_date).toLocaleDateString();
            eodLatest.textContent = `Latest: ${date}`;
          } else {
            eodLatest.textContent = 'No reports yet';
          }
        }
      } catch (e) {
        console.error(`Failed to load details for ${storeName}:`, e);
      }
    }
    
    renderStores();
  }

  // Add Employee nav button for managers: prompt and create employee
  if (path === "manager.html" && session?.role === "manager") {
    const addEmpNav = qs("addEmployeeNavBtn");
    if (addEmpNav) {
      addEmpNav.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          // Load stores to help the manager choose a valid store id
          const stores = await loadStores();
          let storeChoice = null;
          if (stores.length === 0) {
            showWarning('No stores found. Please add a store first.');
            return;
          } else if (stores.length === 1) {
            storeChoice = stores[0].name;
          } else {
            const names = stores.map(s => s.name).join(', ');
            storeChoice = prompt(`Enter store name for the employee. Available stores: ${names}`);
            if (!storeChoice) return;
          }

          const empName = prompt('Enter employee name:');
          if (!empName || !empName.trim()) {
            showWarning('Employee name is required');
            return;
          }

          const role = prompt('Enter role (optional):', 'Employee');

          const res = await addEmployee(storeChoice, empName.trim(), role ? role.trim() : null);
          showSuccess('Employee created with ID: ' + (res && res.id ? res.id : JSON.stringify(res)), "Employee Created");
          // Optionally refresh the manager page store details if visible
          if (typeof renderStores === 'function') renderStores();
        } catch (err) {
          console.error('Add employee failed', err);
          showError('Failed to add employee: ' + (err.message || err));
        }
      });
    }
  }
  
  // Store EOD List page
  if (path === "store-eod-list.html") {
    const eodListContainer = qs("eodListContainer");
    const backBtn = qs("backBtn");
    const storeTitle = qs("storeTitle");
    
    // Get store name from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const storeName = urlParams.get("store") || "Store";
    
    // Update title
    if (storeTitle) {
      storeTitle.innerHTML = `End of Day Reports — <span style="color:#000000;font-weight:bold;">${escapeHtml(storeName)}</span>`;
    }
    
    // Back button handler
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        window.location = "manager.html";
      });
    }
    
    // Load and display EOD reports
    async function loadEODReports() {
      try {
        const eods = await loadEods(storeName);
        if (!eodListContainer) return;
        
        if (eods.length === 0) {
          eodListContainer.innerHTML = '<div class="no-data" style="text-align:center;padding:40px;">No EOD reports found for this store.</div>';
          return;
        }
        
        // Normalize dates for comparison
        const normalizeDate = (dateStr) => {
          if (!dateStr) return "";
          const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
          return match ? match[1] : dateStr;
        };
        
        // Group EODs by date and get the latest one for each date
        const eodsByDate = {};
        eods.forEach(eod => {
          const normalizedDate = normalizeDate(eod.report_date);
          if (!normalizedDate) return;
          
          if (!eodsByDate[normalizedDate]) {
            eodsByDate[normalizedDate] = [];
          }
          eodsByDate[normalizedDate].push(eod);
        });
        
        // Sort each group by created_at descending and take the first (latest) one
        const latestEods = [];
        Object.keys(eodsByDate).forEach(date => {
          const dateEods = eodsByDate[date];
          dateEods.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateB - dateA; // Descending order (newest first)
          });
          latestEods.push(dateEods[0]); // Take the latest one
        });
        
        // Sort all latest EODs by date descending (newest dates first)
        latestEods.sort((a, b) => {
          const dateA = normalizeDate(a.report_date);
          const dateB = normalizeDate(b.report_date);
          return dateB.localeCompare(dateA); // Descending order
        });
        
        eodListContainer.innerHTML = `
          <div style="display:grid;gap:16px;">
            ${latestEods.map(eod => {
              const date = new Date(eod.report_date).toLocaleDateString('en-US', { 
                month: '2-digit',
                day: '2-digit',
                year: 'numeric'
              });
              const submittedBy = eod.submitted_by || 'Unknown';
              // Parse created_at - if it doesn't have timezone info, treat it as UTC
              let createdAt = eod.created_at ? new Date(eod.created_at) : new Date();
              // If the date string doesn't have timezone info (no Z or +/-), treat it as UTC
              if (eod.created_at && typeof eod.created_at === 'string' && !eod.created_at.match(/[+-]\d{2}:\d{2}|Z$/)) {
                // Treat as UTC by appending 'Z' or creating a UTC date
                createdAt = new Date(eod.created_at + (eod.created_at.endsWith('Z') ? '' : 'Z'));
              }
              let timeStr = 'N/A';
              if (createdAt && !isNaN(createdAt.getTime())) {
                // toLocaleString automatically converts UTC to local timezone
                timeStr = createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
              }
              const cashAmount = eod.cash_amount || 0;
              const creditAmount = eod.credit_amount || 0;
              const qpayAmount = eod.qpay_amount || 0;
              const totalAmount = cashAmount + creditAmount + qpayAmount;
              
              // Get employee names who worked that day
              const employeesWorked = eod.employees_worked || [];
              const employeesHtml = employeesWorked.length > 0 
                ? `<p style="margin:0 0 6px 0;color:#495057;font-size:0.9rem;"><strong>Employees:</strong> <span style="color:#007bff;">${employeesWorked.map(name => escapeHtml(name)).join(', ')}</span></p>`
                : '';
              
              // Normalize report_date to YYYY-MM-DD format for URL
              const normalizeDateForUrl = (dateStr) => {
                if (!dateStr) return "";
                const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
                return match ? match[1] : dateStr;
              };
              const normalizedDate = normalizeDateForUrl(eod.report_date);
              
              return `
                <div style="background:white;padding:24px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);border:1px solid #e9ecef;cursor:pointer;transition:all 0.2s ease;" 
                     onmouseover="this.style.boxShadow='0 6px 16px rgba(0,0,0,0.15)';this.style.transform='translateY(-2px)'" 
                     onmouseout="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';this.style.transform='none'"
                     onclick="window.location='store-eod-detail.html?store=${encodeURIComponent(storeName)}&date=${normalizedDate}'">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div style="flex:1;">
                      <h3 style="margin:0 0 12px 0;color:#2c3e50;font-size:1.5rem;font-weight:700;">${date}</h3>
                      <p style="margin:0 0 6px 0;color:#000;font-size:0.9rem;"><strong>Submitted by:</strong> <span style="color:#007bff;font-weight:normal;">${escapeHtml(submittedBy)}</span></p>
                      ${employeesHtml}
                      <p style="margin:6px 0 0 0;color:#6c757d;font-size:0.9rem;">Time: ${timeStr}</p>
                      <p style="margin:12px 0 0 0;color:#6c757d;font-size:0.85rem;font-style:italic;">Click to view details</p>
                    </div>
                    
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } catch (e) {
        console.error("Failed to load EOD reports", e);
        if (eodListContainer) {
          eodListContainer.innerHTML = '<div class="no-data" style="text-align:center;padding:40px;color:#dc3545;">Failed to load EOD reports. Please try again.</div>';
        }
      }
    }
    
    loadEODReports();
  }
  
  // Store EOD Detail page
  if (path === "store-eod-detail.html") {
    const eodDetailContainer = qs("eodDetailContainer");
    const backToListBtn = qs("backToListBtn");
    const eodDetailTitle = qs("eodDetailTitle");
    
    // Get store name and date from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const storeName = urlParams.get("store") || "Store";
    const reportDate = urlParams.get("date");
    
    // Update title
    if (eodDetailTitle && reportDate) {
      const dateStr = new Date(reportDate).toLocaleDateString('en-US', { 
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      });
      eodDetailTitle.textContent = `${storeName} — EOD Report: ${dateStr}`;
    }
    
    // Back button handler
    if (backToListBtn) {
      backToListBtn.addEventListener("click", () => {
        window.location = `store-eod-list.html?store=${encodeURIComponent(storeName)}`;
      });
    }
    
    // Load and display EOD report details
    async function loadEODDetail() {
      try {
        const eods = await loadEods(storeName);
        // Normalize dates for comparison - handle both "2025-01-15" and "2025-01-15T00:00:00Z" formats
        const normalizeDate = (dateStr) => {
          if (!dateStr) return "";
          // Extract just the date part (YYYY-MM-DD)
          const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
          return match ? match[1] : dateStr;
        };
        const normalizedReportDate = normalizeDate(reportDate);
        
        // Filter EODs for this date and sort by created_at descending to get the latest one
        const matchingEods = eods.filter(r => {
          const normalizedRDate = normalizeDate(r.report_date);
          return normalizedRDate === normalizedReportDate;
        });
        
        // Sort by created_at descending (newest first) and take the first one
        matchingEods.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA; // Descending order (newest first)
        });
        
        const eod = matchingEods[0]; // Get the latest EOD for this date
        
        if (!eodDetailContainer) return;
        
        if (!eod) {
          eodDetailContainer.innerHTML = '<div class="no-data" style="text-align:center;padding:40px;color:#dc3545;">EOD report not found.</div>';
          return;
        }
        
        const dateStr = new Date(eod.report_date).toLocaleDateString('en-US', { 
          month: '2-digit',
          day: '2-digit',
          year: 'numeric'
        });
        const submittedBy = eod.submitted_by || 'Unknown';
        // Parse created_at - if it doesn't have timezone info, treat it as UTC
        let createdAt = eod.created_at ? new Date(eod.created_at) : new Date();
        // If the date string doesn't have timezone info (no Z or +/-), treat it as UTC
        if (eod.created_at && typeof eod.created_at === 'string' && !eod.created_at.match(/[+-]\d{2}:\d{2}|Z$/)) {
          // Treat as UTC by appending 'Z'
          createdAt = new Date(eod.created_at + 'Z');
        }
        let timeStr = 'N/A';
        if (createdAt && !isNaN(createdAt.getTime())) {
          // toLocaleString methods automatically convert UTC to local timezone
          timeStr = createdAt.toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric'
          }) + ', ' + createdAt.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit', 
            hour12: false
          });
        }
        
        const cashAmount = eod.cash_amount || 0;
        const creditAmount = eod.credit_amount || 0;
        const qpayAmount = eod.qpay_amount || 0;
        const boxesCount = eod.boxes_count || 0;
        const total1 = eod.total1 || 0;
        const total2 = total1 - (cashAmount + creditAmount);
        const notes = eod.notes || 'Normal operations';
        
        // Determine indicator for total2
        let total2Indicator = '';
        if (total1 === total2) {
          total2Indicator = '<span style="color:#28a745;font-size:1.2rem;margin-left:8px;">✓</span>';
        } else if (total2 > 0) {
          total2Indicator = `<span style="color:#dc3545;font-weight:600;margin-left:8px;">${total2.toFixed(2)} short</span>`;
        } else if (total2 < 0) {
          total2Indicator = `<span style="color:#007bff;font-weight:600;margin-left:8px;">${Math.abs(total2).toFixed(2)} more</span>`;
        }
        
        eodDetailContainer.innerHTML = `
          <div style="background:white;padding:32px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);border:1px solid #e9ecef;">
            <!-- Report Details Section -->
            <div style="margin-bottom:32px;">
              <h3 style="margin:0 0 16px 0;color:#2c3e50;font-size:1.2rem;font-weight:700;border-bottom:2px solid #e9ecef;padding-bottom:8px;">Report Details</h3>
              <div style="display:grid;gap:12px;">
                <div><strong>Date:</strong> ${dateStr}</div>
                <div><strong>Submitted By:</strong> ${escapeHtml(submittedBy)}</div>
                <div><strong>Submission Time:</strong> ${timeStr}</div>
              </div>
            </div>
            
            <!-- Financial Summary Section -->
            <div style="margin-bottom:32px;">
              <h3 style="margin:0 0 16px 0;color:#2c3e50;font-size:1.2rem;font-weight:700;border-bottom:2px solid #e9ecef;padding-bottom:8px;">Financial Summary</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                <div><strong style="color:#28a745;">Cash Amount:</strong> <span style="color:#28a745;font-weight:600;">$${cashAmount.toFixed(2)}</span></div>
                <div><strong style="color:#007bff;">Credit Amount:</strong> <span style="color:#007bff;font-weight:600;">$${creditAmount.toFixed(2)}</span></div>
                <div><strong style="color:#fd7e14;">QPay Amount:</strong> <span style="color:#fd7e14;font-weight:600;">$${qpayAmount.toFixed(2)}</span></div>
                <div><strong>Total1:</strong> <span style="font-weight:600;">$${total1.toFixed(2)}</span></div>
                <div><strong>Boxes Count:</strong> ${boxesCount}</div>
                <div><strong>Total2:</strong> <span style="font-weight:600;">$${total2.toFixed(2)}</span>${total2Indicator}</div>
              </div>
            </div>
            
            <!-- Notes Section -->
            <div>
              <h3 style="margin:0 0 16px 0;color:#2c3e50;font-size:1.2rem;font-weight:700;border-bottom:2px solid #e9ecef;padding-bottom:8px;">Notes</h3>
              <div style="padding:16px;background:#fff3cd;border-radius:8px;border-left:4px solid #ffc107;">
                <p style="margin:0;color:#856404;">${escapeHtml(notes)}</p>
              </div>
            </div>
          </div>
        `;
      } catch (e) {
        console.error("Failed to load EOD detail", e);
        if (eodDetailContainer) {
          eodDetailContainer.innerHTML = '<div class="no-data" style="text-align:center;padding:40px;color:#dc3545;">Failed to load EOD report details. Please try again.</div>';
        }
      }
    }
    
    if (reportDate) {
      loadEODDetail();
    } else {
      if (eodDetailContainer) {
        eodDetailContainer.innerHTML = '<div class="no-data" style="text-align:center;padding:40px;color:#dc3545;">Invalid report date.</div>';
      }
    }
  }
  
  // Store Inventory page (Manager view)
  if (path === "store-inventory.html") {
    const session = loadSession();
    if (!session || session.role !== 'manager') {
      showError('Access denied. Manager login required.');
      window.location = 'index.html';
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const storeName = urlParams.get('store') || 'Store';
    const inventoryTableBody = qs("inventoryTableBody");
    const addItemBtn = qs("addItemBtn");
    const inventorySearch = qs("inventorySearch");
    const storeTitle = qs("storeTitle");
    const backBtn = qs("backBtn");
    
    // Update title
    if (storeTitle) {
      storeTitle.textContent = `📦 Inventory Management — ${storeName}`;
    }
    
    // Back button
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location = 'manager.html';
      });
    }
    
    window.renderInventory = async function() {
      try {
        const items = await loadInventory(storeName);
        if (!inventoryTableBody) return;
        
        let displayItems = items;
        
        // Filter by search if search term exists
        if (inventorySearch && inventorySearch.value.trim()) {
          const searchTerm = inventorySearch.value.trim().toLowerCase();
          displayItems = items.filter(item => 
            item.name.toLowerCase().includes(searchTerm) || 
            (item.sku && item.sku.toLowerCase().includes(searchTerm))
          );
        }
        
        inventoryTableBody.innerHTML = "";
        if (displayItems.length === 0) {
          inventoryTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#6c757d;">No inventory items found</td></tr>';
          return;
        }
        
        // Calculate totals for phones and simcards
        let phonesTotal = 0;
        let simcardsTotal = 0;
        
        displayItems.forEach(item => {
          const qty = item.quantity || 0;
          const nameLower = (item.name || '').toLowerCase();
          const skuLower = (item.sku || '').toLowerCase();
          // Check both name and SKU for simcards
          if (nameLower.includes('sim') || nameLower.includes('simcard') || 
              skuLower.includes('sim') || skuLower.includes('simcard')) {
            simcardsTotal += qty;
          } else {
            phonesTotal += qty;
          }
        });
        
        // Manager view: show all buttons (Update, Edit, Remove)
        displayItems.forEach(item => {
          const tr = document.createElement("tr");
          const itemId = item._id || item.id || '';
          tr.innerHTML = `
            <td>${escapeHtml(item.name || '')}</td>
            <td>${escapeHtml(item.sku || '')}</td>
            <td>${item.quantity || 0}</td>
            <td><input type="number" class="stage-input" value="${item.quantity || 0}" data-item-id="${escapeHtml(itemId)}" data-item-sku="${escapeHtml(item.sku || '')}" data-item-name="${escapeHtml(item.name || '')}" /></td>
            <td style="display:flex;gap:8px;">
              <button class="stage-btn" onclick="handleUpdateInventoryItem('${escapeHtml(itemId)}', '${escapeHtml(item.sku || '')}')">Update</button>
              <button class="stage-btn" onclick="handleEditInventoryItem('${escapeHtml(itemId)}', '${escapeHtml(item.sku || '')}', '${escapeHtml(item.name || '')}')" style="background:#ffc107;color:#000;">Edit</button>
              <button class="stage-btn" onclick="handleRemoveInventoryItem('${escapeHtml(item.sku || '')}', '${escapeHtml(item.name || '')}')" style="background:#dc3545;">Remove</button>
            </td>
          `;
          inventoryTableBody.appendChild(tr);
        });
        
        // Add phones summary row
        const phonesRow = document.createElement("tr");
        phonesRow.className = "special-row";
        phonesRow.style.background = "#fff3cd";
        phonesRow.style.fontWeight = "700";
        phonesRow.innerHTML = `
          <td><strong>phones</strong></td>
          <td>-</td>
          <td><strong>${phonesTotal}</strong></td>
          <td>-</td>
          <td>-</td>
        `;
        inventoryTableBody.appendChild(phonesRow);
        
        // Add simcards summary row
        const simcardsRow = document.createElement("tr");
        simcardsRow.className = "special-row";
        simcardsRow.style.background = "#fff3cd";
        simcardsRow.style.fontWeight = "700";
        simcardsRow.innerHTML = `
          <td><strong>simcard</strong></td>
          <td>-</td>
          <td><strong>${simcardsTotal}</strong></td>
          <td>-</td>
          <td>-</td>
        `;
        inventoryTableBody.appendChild(simcardsRow);
      } catch (e) {
        console.error("Inventory load failed", e);
        if (inventoryTableBody) {
          inventoryTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc3545;">Failed to load inventory</td></tr>';
        }
      }
    };
    
    // Update inventory item handler for manager
    window.handleUpdateInventoryItem = async function(itemId, sku) {
      let input = null;
      if (itemId) {
        input = document.querySelector(`input[data-item-id="${itemId}"]`);
      }
      if (!input && sku) {
        input = document.querySelector(`input[data-item-sku="${sku}"]`);
      }
      if (!input) return;
      
      const newQuantity = parseInt(input.value) || 0;
      
      try {
        await updateInventoryItem(storeName, sku, newQuantity, itemId);
        await renderInventory();
        showSuccess("Inventory updated successfully!");
      } catch (e) {
        showError("Failed to update inventory: " + (e.message || "Unknown error"));
      }
    };
    
    // Edit inventory item handler for manager
    window.handleEditInventoryItem = function(itemId, sku, name) {
      openEditItemModal(itemId, sku, name);
    };
    
    // Remove inventory item handler for manager
    window.handleRemoveInventoryItem = async function(sku, name) {
      if (!confirm(`Are you sure you want to remove "${name}" (SKU: ${sku})? This action cannot be undone.`)) {
        return;
      }
      
      try {
        await deleteInventoryItem(storeName, sku);
        await renderInventory();
        showSuccess("Item removed successfully!");
      } catch (e) {
        showError("Failed to remove item: " + (e.message || "Unknown error"));
      }
    };
    
    // Override submitEditItem for manager context
    const originalSubmitEditItem = window.submitEditItem;
    window.submitEditItem = async function() {
      const session = loadSession();
      if (!session || session.role !== 'manager') {
        showError("Session expired. Please login again.");
        return;
      }
  
      const nameInput = qs("editItemName");
      const skuInput = qs("editItemSku");
      const oldSkuInput = qs("editItemOldSku");
      const itemIdInput = qs("editItemId");
      const errorDiv = qs("editItemError");
      
      if (!nameInput || !skuInput || !oldSkuInput) return;
      
      const name = nameInput.value.trim();
      const newSku = skuInput.value.trim();
      const oldSku = oldSkuInput.value.trim();
      const itemId = itemIdInput ? itemIdInput.value.trim() : null;
      
      if (!name) {
        showError("editItemError", "Item name is required");
        nameInput.focus();
        return;
      }
      
      if (!newSku) {
        showError("editItemError", "SKU is required");
        skuInput.focus();
        return;
      }
      
      if (!oldSku && !itemId) {
        showError("editItemError", "Error: Original SKU or item ID not found");
        return;
      }
      
      hideError("editItemError");
      
      try {
        await updateInventoryItemDetails(storeName, oldSku, name, newSku, itemId);
        
        closeEditItemModal();
        
        if (typeof window.renderInventory === 'function') {
          await window.renderInventory();
        } else {
          window.location.reload();
        }
      } catch (e) {
        showError("editItemError", "Failed to update item: " + (e.message || "Unknown error"));
      }
    };
    
    // Override submitAddItem for manager context
    const originalSubmitAddItem = window.submitAddItem;
    window.submitAddItem = async function() {
      const session = loadSession();
      if (!session || session.role !== 'manager') {
        showError("Session expired. Please login again.");
        return;
      }
  
      const nameInput = qs("itemName");
      const skuInput = qs("itemSku");
      const qtyInput = qs("itemQuantity");
      const errorDiv = qs("addItemError");
      
      if (!nameInput || !skuInput || !qtyInput) return;
      
      const name = nameInput.value.trim();
      const sku = skuInput.value.trim();
      const quantity = parseInt(qtyInput.value) || 0;
      
      if (!name) {
        showError("addItemError", "Item name is required");
        nameInput.focus();
        return;
      }
      
      if (!sku) {
        showError("addItemError", "SKU is required");
        skuInput.focus();
        return;
      }
      
      hideError("addItemError");
      
      try {
        await addInventoryItem(storeName, name, sku, quantity);
        
        window.closeAddItemModal();
        
        if (typeof window.renderInventory === 'function') {
          await window.renderInventory();
        } else {
          window.location.reload();
        }
      } catch (e) {
        showError("addItemError", "Failed to add item: " + (e.message || "Unknown error"));
      }
    };
    
    // Search handler
    if (inventorySearch) {
      inventorySearch.addEventListener("input", () => {
        renderInventory();
      });
    }
    
    // Add item button handler
    if (addItemBtn) {
      addItemBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof window.openAddItemModal === 'function') {
          window.openAddItemModal();
        }
      });
    }
    
    renderInventory();
  }
});
