// timeclock-handler.js
// Handles the timeclock page logic with face recognition

document.addEventListener('DOMContentLoaded', async () => {
  // Only run on timeclock page
  if (!document.getElementById('timeclockTabRoot')) return;
  
  // Get session
  const session = loadSession();
  if (!session || session.role !== 'store') {
    window.location = 'index.html';
    return;
  }
  
  const storeId = session.storeId || session.storeName;
  
  // Get elements
  const statusText = document.getElementById('statusText');
  const timeDisplay = document.getElementById('timeDisplay');
  const clockInBtn = document.getElementById('clockInBtn');
  const clockOutBtn = document.getElementById('clockOutBtn');
  const cameraContainer = document.getElementById('cameraContainer');
  const video = document.getElementById('video');
  const captureBtn = document.getElementById('captureBtn');
  const cancelCameraBtn = document.getElementById('cancelCameraBtn');
  const photoPreview = document.getElementById('photoPreview');
  const capturedPhoto = document.getElementById('capturedPhoto');
  const recognitionResult = document.getElementById('recognitionResult');
  const confirmPhotoBtn = document.getElementById('confirmPhotoBtn');
  const retakeBtn = document.getElementById('retakeBtn');
  const loadingIndicator = document.getElementById('loadingIndicator');
  
  let currentAction = null; // 'clock-in' or 'clock-out'
  let capturedData = null; // Stores captured face data
  
  // Update time display
  function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    if (timeDisplay) {
      timeDisplay.textContent = timeStr;
    }
  }
  
  setInterval(updateTime, 1000);
  updateTime();
  
  // Show loading
  function showLoading(show = true) {
    if (loadingIndicator) {
      loadingIndicator.style.display = show ? 'block' : 'none';
    }
  }
  
  // Update status
  function updateStatus(text, color = '#6c757d') {
    if (statusText) {
      statusText.textContent = text;
      statusText.style.color = color;
    }
  }
  
  // Show camera
  async function showCamera(action) {
    currentAction = action;
    
    // Hide buttons and preview
    if (document.getElementById('clockButtons')) {
      document.getElementById('clockButtons').style.display = 'none';
    }
    if (photoPreview) photoPreview.style.display = 'none';
    
    // Show camera container
    if (cameraContainer) cameraContainer.style.display = 'block';
    
    updateStatus(`Position your face in the camera for ${action === 'clock-in' ? 'Clock In' : 'Clock Out'}`, '#007bff');
    
    // Initialize camera
    const result = await initializeCamera(video);
    
    if (!result.success) {
      showError('Failed to access camera: ' + result.error);
      hideCamera();
      return;
    }
    
    // Load face-api models if not loaded
    showLoading(true);
    updateStatus('Loading face recognition models...', '#007bff');
    
    const modelsLoaded = await loadFaceApiModels();
    
    showLoading(false);
    
    if (!modelsLoaded) {
      showError('Failed to load face recognition models. Please refresh the page.');
      hideCamera();
      return;
    }
    
    updateStatus(`Ready! Position your face in the camera`, '#28a745');
  }
  
  // Hide camera
  function hideCamera() {
    stopCamera(video);
    
    if (cameraContainer) cameraContainer.style.display = 'none';
    if (photoPreview) photoPreview.style.display = 'none';
    if (document.getElementById('clockButtons')) {
      document.getElementById('clockButtons').style.display = 'flex';
    }
    
    currentAction = null;
    capturedData = null;
    
    updateStatus('Ready to Clock In or Clock Out', '#6c757d');
  }
  
  // Capture face
  async function captureFace() {
    showLoading(true);
    updateStatus('Detecting face...', '#007bff');
    
    const result = await captureFaceFromVideo(video);
    
    showLoading(false);
    
    if (!result.success) {
      showError('Failed to detect face: ' + result.error + '\n\nPlease ensure:\n- Your face is clearly visible\n- Good lighting\n- Look directly at the camera', 'Face Detection Failed');
      return;
    }
    
    // Store captured data
    capturedData = {
      descriptor: result.descriptor,
      imageDataUrl: result.imageDataUrl
    };
    
    // Stop camera
    stopCamera(video);
    
    // Show preview
    if (cameraContainer) cameraContainer.style.display = 'none';
    if (photoPreview) photoPreview.style.display = 'block';
    if (capturedPhoto) capturedPhoto.src = result.imageDataUrl;
    
    // Recognize face
    updateStatus('Recognizing face...', '#007bff');
    showLoading(true);
    
    const recognizeResult = await recognizeFace(result.descriptor, storeId);
    
    showLoading(false);
    
    if (recognizeResult.success) {
      const employee = recognizeResult.data;
      const confidence = (employee.confidence * 100).toFixed(1);
      
      if (recognitionResult) {
        recognitionResult.innerHTML = `
          <div style="color:#28a745;font-size:1.2rem;font-weight:600;margin-bottom:8px;">
            ✅ Face Recognized
          </div>
          <div style="color:#2c3e50;font-size:1.1rem;margin-bottom:4px;">
            <strong>${employee.employee_name}</strong>
          </div>
          <div style="color:#6c757d;font-size:0.9rem;">
            Confidence: ${confidence}%
          </div>
        `;
      }
      
      updateStatus(`Face recognized: ${employee.employee_name}`, '#28a745');
    } else {
      if (recognitionResult) {
        recognitionResult.innerHTML = `
          <div style="color:#dc3545;font-size:1.2rem;font-weight:600;margin-bottom:8px;">
            ❌ Face Not Recognized
          </div>
          <div style="color:#6c757d;font-size:0.9rem;margin-bottom:12px;">
            ${recognizeResult.error || 'Face not recognized.'}
          </div>
          <div style="padding:12px;background:#fff3cd;border-radius:8px;margin-top:12px;border:1px solid #ffc107;">
            <div style="color:#856404;font-size:0.9rem;font-weight:600;margin-bottom:8px;">
              Changed your appearance?
            </div>
            <div style="color:#856404;font-size:0.85rem;margin-bottom:12px;">
              If you grew a beard, changed hairstyle, or wore glasses, you can add your new appearance here.
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <input type="text" id="employeeNameInput" placeholder="Enter your full name" 
                     style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:0.9rem;">
            </div>
            <button id="addAppearanceBtn" 
                    style="width:100%;padding:10px;background:#ffc107;color:#212529;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.9rem;">
              ➕ Add New Appearance
            </button>
            <div style="color:#856404;font-size:0.75rem;margin-top:8px;text-align:center;">
              Or contact your manager to re-register your face
            </div>
          </div>
        `;
        
        // Add event listener for add appearance button
        const addAppearanceBtn = document.getElementById('addAppearanceBtn');
        if (addAppearanceBtn) {
          addAppearanceBtn.addEventListener('click', async () => {
            const employeeName = document.getElementById('employeeNameInput')?.value.trim();
            if (!employeeName) {
              showError('Please enter your name');
              return;
            }
            
            if (!capturedData) {
              showError('No face data captured. Please retake photo.');
              return;
            }
            
            showLoading(true);
            updateStatus('Adding new appearance...', '#007bff');
            
            try {
              const response = await fetch('/api/face/add-appearance', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  employee_name: employeeName,
                  face_descriptor: capturedData.descriptor,
                  face_image: capturedData.imageDataUrl
                })
              });
              
              const data = await response.json();
              
              showLoading(false);
              
              if (response.ok && data.success) {
                showInfo(`✅ New appearance added successfully!\n\nYou now have ${data.total_registrations} registered appearance(s).\n\nPlease try clocking in again.`);
                
                // Clear the form
                if (recognitionResult) recognitionResult.innerHTML = '';
                hideCamera();
              } else {
                showError('Failed to add appearance: ' + (data.error || 'Unknown error'));
              }
            } catch (err) {
              showLoading(false);
              showError('Failed to add appearance: ' + err.message);
            }
          });
        }
      }
      
      updateStatus('Face not recognized', '#dc3545');
    }
  }
  
  // Confirm and process
  async function confirmAndProcess() {
    if (!capturedData) {
      showWarning('No face data captured');
      return;
    }
    
    showLoading(true);
    updateStatus('Processing...', '#007bff');
    
    let result;
    
    if (currentAction === 'clock-in') {
      result = await clockInWithFace(capturedData.descriptor, capturedData.imageDataUrl, storeId);
    } else if (currentAction === 'clock-out') {
      result = await clockOutWithFace(capturedData.descriptor, capturedData.imageDataUrl, storeId);
    }
    
    showLoading(false);
    
    if (result && result.success) {
      const data = result.data;
      const actionText = currentAction === 'clock-in' ? 'Clocked In' : 'Clocked Out';
      const time = new Date(currentAction === 'clock-in' ? data.clock_in_time : data.clock_out_time);
      const timeStr = time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      updateStatus(`✅ ${actionText} Successfully!`, '#28a745');
      
      let message = `${actionText} Successfully!\n\n`;
      message += `Employee: ${data.employee_name}\n`;
      message += `Time: ${timeStr}\n`;
      
      if (currentAction === 'clock-out' && data.hours_worked) {
        message += `Hours Worked: ${data.hours_worked} hours`;
      }
      
      showInfo(message);
      
      // Reset
      hideCamera();
    } else {
      const errorMsg = result ? result.error : 'Unknown error occurred';
      updateStatus(`❌ Failed: ${errorMsg}`, '#dc3545');
      showError('Failed to ' + (currentAction === 'clock-in' ? 'clock in' : 'clock out') + ':\n\n' + errorMsg);
    }
  }
  
  // Event listeners
  if (clockInBtn) {
    clockInBtn.addEventListener('click', () => {
      showCamera('clock-in');
    });
  }
  
  if (clockOutBtn) {
    clockOutBtn.addEventListener('click', () => {
      showCamera('clock-out');
    });
  }
  
  if (captureBtn) {
    captureBtn.addEventListener('click', captureFace);
  }
  
  if (cancelCameraBtn) {
    cancelCameraBtn.addEventListener('click', hideCamera);
  }
  
  if (confirmPhotoBtn) {
    confirmPhotoBtn.addEventListener('click', confirmAndProcess);
  }
  
  if (retakeBtn) {
    retakeBtn.addEventListener('click', () => {
      if (photoPreview) photoPreview.style.display = 'none';
      showCamera(currentAction);
    });
  }
});
