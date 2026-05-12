/* ═══════════════════════════════════════════════════════════
   SMART HOME AI — script.js (Optimized for iOS)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ─── App State ────────────────────────────────────────────────────────
    const appState = {
        activeCamera: {
            id: 'cam-01',
            name: 'Camera Tiền sảnh A1'
        },
        filters: {
            helmet: true,
            vest: true,
            pose: true
        },
        isProcessing: false
    };

    // ─── DOM Elements ─────────────────────────────────────────────────────
    const mainVideo = document.getElementById('main-video');
    const videoWebcam = document.getElementById('webcam');
    const btnStart = document.getElementById('btn-start-cam');
    const btnStop = document.getElementById('btn-stop-cam');
    const camSourceSelect = document.getElementById('cam-source-select');
    
    // Filter Elements
    const filterHelmet = document.getElementById('filter-helmet');
    const filterVest = document.getElementById('filter-vest');
    const filterPose = document.getElementById('filter-pose');

    // Stats Elements
    const violationHistoryBody = document.getElementById('violation-history-body');
    const ppeAudio = document.getElementById('audio-warning');
    const alarmAudio = document.getElementById('audio-alarm');

    // ─── Filter Logic ─────────────────────────────────────────────────────
    const updateFilters = () => {
        appState.filters.helmet = filterHelmet.checked;
        appState.filters.vest = filterVest.checked;
        appState.filters.pose = filterPose.checked;
        console.log("Filters Updated:", appState.filters);
    };

    filterHelmet.addEventListener('change', updateFilters);
    filterVest.addEventListener('change', updateFilters);
    filterPose.addEventListener('change', updateFilters);

    // ─── Notification System ──────────────────────────────────────────────
    function sendPushNotification(title, message) {
        // Browser Notification
        if ("Notification" in window) {
            if (Notification.permission === "granted") {
                new Notification(title, { body: message, icon: 'assets/icons/icon-192x192.png' });
            } else if (Notification.permission !== "denied") {
                Notification.requestPermission();
            }
        }
        
        // Mobile Modal Simulation (Always show in UI)
        showInAppAlert(title, message);
    }

    function showInAppAlert(title, message) {
        const alertBox = document.createElement('div');
        alertBox.className = 'in-app-alert glass';
        alertBox.innerHTML = `
            <div class="alert-icon"><i data-lucide="alert-triangle"></i></div>
            <div class="alert-body">
                <strong>${title}</strong>
                <p>${message}</p>
            </div>
        `;
        document.body.appendChild(alertBox);
        lucide.createIcons();
        
        setTimeout(() => alertBox.classList.add('show'), 100);
        setTimeout(() => {
            alertBox.classList.remove('show');
            setTimeout(() => alertBox.remove(), 500);
        }, 5000);
    }

    // ─── Real-time API & Alert Logic ──────────────────────────────────────
    let lastLogTime = "";

    async function fetchSystemData() {
        try {
            const logsRes = await fetch('/api/logs');
            const data = await logsRes.json();
            const logs = data.logs || [];

            if (logs.length > 0) {
                const latestLog = logs[0];
                if (latestLog.time !== lastLogTime) {
                    lastLogTime = latestLog.time;
                    processLogWithFilters(latestLog);
                }
                renderHistory(logs);
            }
        } catch (e) {
            console.error("API Error:", e);
        }
    }

    function processLogWithFilters(log) {
        let shouldAlert = false;
        let alertType = "";

        // Logic lọc dựa trên cấu hình người dùng
        if (log.type === 'PPE') {
            if (log.detail.includes('mũ') && appState.filters.helmet) shouldAlert = true;
            if (log.detail.includes('áo') && appState.filters.vest) shouldAlert = true;
            alertType = "CẢNH BÁO AN TOÀN";
        } else if (log.type === 'ROI' && appState.filters.pose) {
            // Giả định ROI trong context này là xâm nhập hoặc ngã
            shouldAlert = true;
            alertType = "CẢNH BÁO XÂM NHẬP";
        }

        if (shouldAlert) {
            const message = `Phát hiện vi phạm tại ${appState.activeCamera.name}!`;
            sendPushNotification(alertType, message);
            
            // Play Sound
            if (log.type === 'PPE') ppeAudio.play().catch(() => {});
            else alarmAudio.play().catch(() => {});

            // Visual effect on the camera card
            document.querySelector(`[data-cam-id="${appState.activeCamera.id}"]`).classList.add('pulse-active');
            setTimeout(() => {
                document.querySelector(`[data-cam-id="${appState.activeCamera.id}"]`).classList.remove('pulse-active');
            }, 5000);
        }
    }

    function renderHistory(logs) {
        violationHistoryBody.innerHTML = logs.slice(0, 5).map(log => `
            <tr>
                <td>${log.time}</td>
                <td style="font-weight:600">${appState.activeCamera.name}</td>
                <td><span class="badge-${log.type === 'PPE' ? 'warning' : 'danger'}">${log.type}</span></td>
                <td>#${log.id}</td>
            </tr>
        `).join('');
    }

    // Polling
    setInterval(fetchSystemData, 1500);

    // ─── Camera Management ────────────────────────────────────────────────
    function stopAllCameraTracks() {
        const activeStream = videoWebcam.srcObject;
        if (activeStream) {
            activeStream.getTracks().forEach(track => track.stop());
            videoWebcam.srcObject = null;
        }
    }

    async function initIOSCamera() {
        stopAllCameraTracks();
        const constraints = {
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            mainVideo.style.display = 'none';
            videoWebcam.style.display = 'block';
            videoWebcam.style.opacity = '1';
            videoWebcam.srcObject = stream;
            await videoWebcam.play();
            
            appState.isProcessing = true;
            document.querySelector(`[data-cam-id="${appState.activeCamera.id}"] .status-dot`).classList.remove('offline');
        } catch (err) {
            alert("Lỗi Camera: " + err.name);
            btnStart.disabled = false;
            btnStart.innerHTML = `<i data-lucide="refresh-cw"></i> Thử lại`;
            lucide.createIcons();
        }
    }

    // Event Listeners for Camera
    if (btnStart) {
        btnStart.addEventListener('click', () => {
            const mode = camSourceSelect.value;
            if (mode === '2') {
                initIOSCamera();
            } else {
                mainVideo.src = `/video_feed/1`; // Giả định nguồn 1
                mainVideo.style.display = 'block';
                videoWebcam.style.display = 'none';
            }
            btnStart.disabled = true;
            btnStop.disabled = false;
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            stopAllCameraTracks();
            mainVideo.src = '';
            btnStart.disabled = false;
            btnStop.disabled = true;
            appState.isProcessing = false;
            document.querySelector(`[data-cam-id="${appState.activeCamera.id}"] .status-dot`).classList.add('offline');
        });
    }

    // Switch Camera Logic
    document.querySelectorAll('.camera-card').forEach(card => {
        card.addEventListener('click', function() {
            const camId = this.getAttribute('data-cam-id');
            const camName = this.querySelector('h4').textContent;
            
            // UI Update
            document.querySelectorAll('.camera-card').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            
            // State Update
            appState.activeCamera.id = camId;
            appState.activeCamera.name = camName;
            
            console.log("Switched to:", camName);
        });
    });

    // Request Notification Permission
    if ("Notification" in window) Notification.requestPermission();
});
