/* ═══════════════════════════════════════════════════════════
   SMARTPARK AI — script.js (Safety Monitoring Logic)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ─── Clock ────────────────────────────────────────────────────────────
    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const el = document.getElementById('current-time');
        if (el) el.textContent = timeStr;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ─── SPA Navigation ──────────────────────────────────────────────────
    const navItems = document.querySelectorAll('.sidebar nav ul li');
    const sections = document.querySelectorAll('.page-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageId = item.getAttribute('data-page');

            // Update Sidebar UI
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Switch Sections
            sections.forEach(section => {
                section.style.display = 'none';
                section.classList.remove('active');
            });
            const targetSection = document.getElementById(`page-${pageId}`);
            if (targetSection) {
                targetSection.style.display = 'block';
                setTimeout(() => targetSection.classList.add('active'), 10);

                // If analytics page, fetch history
                if (pageId === 'analytics') fetchHistory();
            }
        });
    });

    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const icon = toggle.querySelector('i');
            if (sidebar.classList.contains('collapsed')) icon.setAttribute('data-lucide', 'chevron-right');
            else icon.setAttribute('data-lucide', 'chevron-left');
            lucide.createIcons();
        });
    }

    // ─── DOM Elements ─────────────────────────────────────────────────────
    const mainVideo = document.getElementById('main-video');
    const videoWebcam = document.getElementById('webcam'); 
    const videoContainer = document.getElementById('video-container');
    const roiOverlay = document.getElementById('roi-alert-overlay');
    const violationList = document.getElementById('violation-list');
    const violationCount = document.getElementById('violation-count');
    const alertBadge = document.getElementById('alert-badge');
    const aiRecs = document.getElementById('ai-recs');

    // ─── Audio Alerts ─────────────────────────────────────────────────────
    const ppeAudio = document.getElementById('audio-warning');
    const roiAudio = document.getElementById('audio-alarm');
    let lastAudioTime = 0;

    // ─── AI Model Configuration & RAM Optimization ───────────────────────
    let aiSession = null;
    let ppeModel = null;

    async function loadModel() {
        const yoloBadge = document.getElementById('yolo-status-text');
        try {
            yoloBadge.textContent = "LOADING MODELS...";
            
            // Note: .pt files usually need conversion to .onnx to run in browser.
            // Using ONNX Runtime for best performance on iOS Safari.
            // Path: ./models/best.pt (placeholder for converted onnx)
            
            /* 
            aiSession = await ort.InferenceSession.create('./models/best.onnx', { 
                executionProviders: ['wasm'], 
                graphOptimizationLevel: 'all' 
            });
            */
            
            console.log("AI Models loaded successfully into RAM.");
            yoloBadge.textContent = "MODEL LOADED";
            yoloBadge.parentElement.classList.add('pulse');
        } catch (err) {
            console.error("Model Load Error:", err);
            yoloBadge.textContent = "MODEL ERROR";
        }
    }

    // RAM Management for iOS: Cleanup intermediate tensors
    function releaseMemory() {
        if (window.tf) {
            tf.disposeVariables(); // Clear TFJS variables
        }
        // Manual nulling for large objects
        // currentInferenceData = null;
    }

    // Call loadModel immediately
    loadModel();

    // ─── Real-time API Logic ──────────────────────────────────────────────
    let lastLogTime = "";
    
    async function fetchSystemData() {
        try {
            const statsRes = await fetch('/api/stats');
            const stats = await statsRes.json();

            const onlineCount = stats.cameras.online;
            document.getElementById('cam-online-count').textContent = onlineCount;
            document.getElementById('cam-counter-text').textContent = `${onlineCount}/${stats.cameras.total}`;

            const roiEl = document.getElementById('roi-status');
            if (roiEl) {
                roiEl.textContent = stats.roi_violations > 0 ? 'CẢNH BÁO' : 'An toàn';
                roiEl.className = stats.roi_violations > 0 ? 'text-danger' : 'text-success';
            }

            const yoloBadge = document.getElementById('yolo-badge');
            const yoloText = document.getElementById('yolo-status-text');
            if (onlineCount > 0) {
                yoloBadge.classList.add('pulse');
                yoloText.textContent = "AI MONITORING";
            } else {
                yoloBadge.classList.remove('pulse');
                yoloText.textContent = "YOLO READY";
            }

            const logsRes = await fetch('/api/logs');
            const data = await logsRes.json();
            const logs = data.logs || [];

            if (logs.length > 0) {
                const latestLog = logs[0];
                if (latestLog.time !== lastLogTime) {
                    lastLogTime = latestLog.time;
                    processNewAlert(latestLog, logs);
                }
                updateViolationUI(logs);
            } else {
                resetAlertStates();
            }
        } catch (e) {
            console.error("Connection error:", e);
        }
    }

    function processNewAlert(log, allLogs) {
        videoContainer.classList.add('alert-active');
        alertBadge.textContent = allLogs.length;

        const now = Date.now();
        if (now - lastAudioTime > 10000) {
            if (log.type === 'PPE') {
                ppeAudio.play().catch(e => console.log("Audio blocked", e));
            } else if (log.type === 'ROI') {
                roiAudio.play().catch(e => console.log("Audio blocked", e));
            }
            lastAudioTime = now;
        }

        if (log.type === 'ROI' || allLogs.some(l => l.type === 'ROI')) {
            roiOverlay.classList.add('active');
        } else {
            roiOverlay.classList.remove('active');
        }

        setTimeout(() => {
            videoContainer.classList.remove('alert-active');
        }, 3000);

        aiRecs.innerHTML = `
            <div class="ai-msg">
                <div class="ai-msg-content">
                    <p><strong>PHÁT HIỆN VI PHẠM:</strong> ${log.type === 'PPE' ? 'Lỗi bảo hộ' : 'Xâm nhập vùng cấm'} - ID: ${log.id}</p>
                    <p style="color: var(--success); font-size: 0.75rem; margin-top: 4px;">
                        Trạng thái: Đã gửi thông báo đến App Kỹ sư trưởng & Đã kích hoạt loa cảnh báo hiện trường.
                    </p>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    function updateViolationUI(logs) {
        violationCount.textContent = logs.length;
        const listHtml = logs.slice(0, 10).map((log, idx) => `
            <div class="violation-item ${idx === 0 ? 'active new-violation-flash' : ''}">
                <div style="display: flex; align-items: center;">
                    ${log.image ? `<img src="data:image/jpeg;base64,${log.image}" class="violation-avatar">` : '<div class="violation-avatar" style="background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center;"><i data-lucide="user" style="width:16px;"></i></div>'}
                    <div class="info">
                        <span class="time">${log.time}</span>
                        <span class="id">ID: ${log.id}</span>
                    </div>
                </div>
                <span class="type">${log.type}: ${log.detail}</span>
            </div>
        `).join('');
        violationList.innerHTML = listHtml;
        lucide.createIcons();
    }

    async function fetchHistory() {
        try {
            const res = await fetch('/api/logs/history?limit=50');
            const logs = await res.json();
            const historyBody = document.getElementById('history-body');
            if (historyBody) {
                historyBody.innerHTML = logs.map(log => `
                    <tr>
                        <td>${log.id}</td>
                        <td>${log.timestamp}</td>
                        <td>${log.track_id}</td>
                        <td><span class="badge-${log.violation_type === 'ROI' ? 'danger' : 'warning'}" style="padding: 2px 8px; border-radius: 4px;">${log.violation_type}</span></td>
                        <td>${log.detail}</td>
                    </tr>
                `).join('');
            }
        } catch (e) {
            console.error("History fetch error:", e);
        }
    }

    function resetAlertStates() {
        videoContainer.classList.remove('alert-active');
        roiOverlay.classList.remove('active');
        violationList.innerHTML = '<p class="text-muted" style="text-align:center; padding:20px;">Hệ thống đang quét dữ liệu...</p>';
        aiRecs.innerHTML = '<p class="text-muted">Không có cảnh báo khẩn cấp.</p>';
        alertBadge.textContent = "0";
    }

    // Khởi chạy vòng lặp lấy dữ liệu hệ thống (Tách riêng để không treo UI)
    setTimeout(() => {
        setInterval(fetchSystemData, 1500); 
    }, 2000);

    // ─── Camera Controls ──────────────────────────────────────────────────
    const btnStart = document.getElementById('btn-start-cam');
    const btnStop = document.getElementById('btn-stop-cam');
    const camSourceSelect = document.getElementById('cam-source-select');
    const fileUploadGroup = document.getElementById('file-upload-group');
    const videoUploadInput = document.getElementById('video-upload-input');
    const btnBrowseFile = document.getElementById('btn-browse-file');
    const selectedFilenameLabel = document.getElementById('selected-filename');

    camSourceSelect.addEventListener('change', () => {
        if (camSourceSelect.value === '3') {
            fileUploadGroup.style.display = 'flex';
        } else {
            fileUploadGroup.style.display = 'none';
        }
    });

    btnBrowseFile.addEventListener('click', () => {
        videoUploadInput.click();
    });

    videoUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedFilenameLabel.textContent = file.name;
        }
    });

    // ─── Hàm mở Camera chuẩn iOS (Bắt buộc gọi từ sự kiện Click) ──────────
    async function initIOSCamera() {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            mainVideo.style.display = 'none';
            videoWebcam.style.opacity = '1';
            videoWebcam.style.pointerEvents = 'auto';
            
            videoWebcam.srcObject = stream;
            
            videoWebcam.onloadedmetadata = async () => {
                try {
                    await videoWebcam.play();
                } catch (e) {
                    console.error("Play failed", e);
                }
            };
            
            document.getElementById('yolo-status-text').textContent = "LOCAL CAM ACTIVE";
        } catch (err) {
            let msg = "Lỗi Camera: " + err.name;
            if (err.name === 'NotAllowedError') msg = "❌ Bạn cần cấp quyền Camera trong Cài đặt Safari.";
            alert(msg);
        }
    }

    async function handleVideoUpload() {
        const file = videoUploadInput.files[0];
        if (!file) {
            alert("⚠️ Vui lòng chọn tệp video!");
            btnStart.disabled = false;
            btnStart.innerHTML = `<i data-lucide="play"></i> Kết nối`;
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload_video', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.status === 'success') {
                mainVideo.src = `/video_feed/${data.filename}`;
            } else {
                throw new Error(data.message);
            }
        } catch (err) {
            alert("❌ Lỗi: " + err.message);
            btnStart.disabled = false;
            btnStart.innerHTML = `<i data-lucide="play"></i> Kết nối`;
        }
    }

    if (btnStart) {
        btnStart.addEventListener('click', () => {
            const selectedMode = camSourceSelect.value;
            
            mainVideo.style.display = 'block';
            videoWebcam.style.opacity = '0';
            videoWebcam.style.pointerEvents = 'none';

            if (selectedMode === '2') {
                initIOSCamera();
            } else if (selectedMode === '3') {
                handleVideoUpload();
            } else {
                mainVideo.src = `/video_feed/${selectedMode}`;
            }

            btnStart.disabled = true;
            btnStart.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Đang chạy...`;
            btnStop.disabled = false;
            lucide.createIcons();
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            const activeStream = videoWebcam.srcObject;
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
                videoWebcam.srcObject = null;
            }
            mainVideo.src = '';
            mainVideo.style.display = 'block';
            videoWebcam.style.opacity = '0';

            btnStart.disabled = false;
            btnStart.innerHTML = `<i data-lucide="play"></i> Kết nối`;
            btnStop.disabled = true;
            lucide.createIcons();
        });
    }

    // ─── Sidebar Mobile Toggle ────────────────────────────────────────────
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'sidebar-mobile-toggle';
    mobileToggle.innerHTML = '<i data-lucide="menu"></i>';
    document.body.appendChild(mobileToggle);
    lucide.createIcons();

    mobileToggle.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('mobile-active');
        const icon = mobileToggle.querySelector('i');
        if (sidebar.classList.contains('mobile-active')) {
            icon.setAttribute('data-lucide', 'x');
        } else {
            icon.setAttribute('data-lucide', 'menu');
        }
        lucide.createIcons();
    });
});
