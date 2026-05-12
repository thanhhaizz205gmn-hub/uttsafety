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

    // ─── Real-time API Logic ──────────────────────────────────────────────
    let lastLogTime = "";
    let isAlertActive = false;

    async function fetchSystemData() {
        try {
            // 1. Fetch Stats
            const statsRes = await fetch('/api/stats');
            const stats = await statsRes.json();

            const onlineCount = stats.cameras.online;
            document.getElementById('cam-online-count').textContent = onlineCount;
            document.getElementById('cam-counter-text').textContent = `${onlineCount}/${stats.cameras.total}`;

            // ROI Status update
            const roiEl = document.getElementById('roi-status');
            if (roiEl) {
                roiEl.textContent = stats.roi_violations > 0 ? 'CẢNH BÁO' : 'An toàn';
                roiEl.className = stats.roi_violations > 0 ? 'text-danger' : 'text-success';
            }

            // YOLO Badge Pulse logic
            const yoloBadge = document.getElementById('yolo-badge');
            const yoloText = document.getElementById('yolo-status-text');
            if (onlineCount > 0) {
                yoloBadge.classList.add('pulse');
                yoloText.textContent = "AI MONITORING";
            } else {
                yoloBadge.classList.remove('pulse');
                yoloText.textContent = "YOLO READY";
            }

            // 2. Fetch Logs
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
        // Visual Alert
        videoContainer.classList.add('alert-active');
        alertBadge.textContent = allLogs.length;

        // Audio Alert with 10s cooldown
        const now = Date.now();
        if (now - lastAudioTime > 10000) {
            if (log.type === 'PPE') {
                ppeAudio.play().catch(e => console.log("Audio blocked", e));
            } else if (log.type === 'ROI') {
                roiAudio.play().catch(e => console.log("Audio blocked", e));
            }
            lastAudioTime = now;
        }

        // ROI Overlay
        if (log.type === 'ROI' || allLogs.some(l => l.type === 'ROI')) {
            roiOverlay.classList.add('active');
        } else {
            roiOverlay.classList.remove('active');
        }

        // Auto reset visual alert after 3 seconds
        setTimeout(() => {
            videoContainer.classList.remove('alert-active');
        }, 3000);

        // Update AI Suggestion - Automated Cycle
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

    setInterval(fetchSystemData, 1000);

    // ─── Camera Controls ──────────────────────────────────────────────────
    const btnStart = document.getElementById('btn-start-cam');
    const btnStop = document.getElementById('btn-stop-cam');
    const camSourceSelect = document.getElementById('cam-source-select');
    const fileUploadGroup = document.getElementById('file-upload-group');
    const videoUploadInput = document.getElementById('video-upload-input');
    const btnBrowseFile = document.getElementById('btn-browse-file');
    const selectedFilenameLabel = document.getElementById('selected-filename');

    // Toggle File Upload UI
    camSourceSelect.addEventListener('change', () => {
        if (camSourceSelect.value === '3') {
            fileUploadGroup.style.display = 'flex';
        } else {
            fileUploadGroup.style.display = 'none';
        }
    });

    // Browse File
    btnBrowseFile.addEventListener('click', () => {
        videoUploadInput.click();
    });

    videoUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            selectedFilenameLabel.textContent = file.name;
        }
    });

    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            const selectedMode = camSourceSelect.value;
            let finalSource = selectedMode;

            // Reset UI
            mainVideo.style.display = 'block';
            localVideo.style.display = 'none';

            // Nếu là chế độ tải lên video
            if (selectedMode === '3') {
                const file = videoUploadInput.files[0];
                if (!file) {
                    alert("⚠️ Vui lòng chọn tệp video trước khi nhấn Kết nối!");
                    return;
                }

                // 1. Upload File
                btnStart.disabled = true;
                btnStart.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Đang xử lý...`;
                lucide.createIcons();

                const formData = new FormData();
                formData.append('file', file);

                try {
                    const uploadRes = await fetch('/api/upload_video', {
                        method: 'POST',
                        body: formData
                    });
                    if (!uploadRes.ok) throw new Error("Server error: " + uploadRes.status);
                    const uploadData = await uploadRes.json();
                    if (uploadData.status === 'success') {
                        finalSource = uploadData.filename;
                    } else {
                        throw new Error(uploadData.message);
                    }
                } catch (err) {
                    alert("❌ Lỗi tải lên: " + err.message);
                    btnStart.disabled = false;
                    btnStart.innerHTML = `<i data-lucide="play"></i> Kết nối`;
                    lucide.createIcons();
                    return;
                }
            }

            // 2. Start Stream
            if (selectedMode === '2') {
                // Local Camera Access (Directly from Browser/PWA)
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    try {
                        // iOS Safari requires specific constraints
                        const constraints = {
                            video: { 
                                facingMode: 'environment', // Use back camera
                                width: { ideal: 1280 },
                                height: { ideal: 720 }
                            },
                            audio: false 
                        };

                        const stream = await navigator.mediaDevices.getUserMedia(constraints);
                        
                        // Switch display elements
                        mainVideo.style.display = 'none';
                        localVideo.style.display = 'block';
                        
                        // Set stream to video element
                        localVideo.srcObject = stream;
                        
                        // iOS requires playsinline, muted, and autoplay (handled in HTML)
                        // but calling play() explicitly is safer
                        try {
                            await localVideo.play();
                        } catch (e) {
                            console.error("Autoplay failed", e);
                            alert("Nhấn vào màn hình để phát video camera.");
                        }
                        
                        document.getElementById('yolo-status-text').textContent = "LOCAL CAM ACTIVE";
                    } catch (err) {
                        let msg = "Không thể truy cập camera.";
                        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                            msg = "❌ Bạn đã chặn quyền truy cập Camera. Vui lòng vào Cài đặt -> Safari -> Camera để cho phép.";
                        } else if (err.name === 'NotFoundError') {
                            msg = "❌ Không tìm thấy thiết bị camera.";
                        }
                        alert(msg);
                        console.error(err);
                        return;
                    }
                } else {
                    alert("Trình duyệt này không hỗ trợ MediaDevices API.");
                    return;
                }
            } else {
                // Remote Stream (Python Backend MJPEG)
                mainVideo.srcObject = null;
                mainVideo.src = `/video_feed/${finalSource}`;
            }

            // UI Feedback
            btnStart.disabled = true;
            btnStart.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Đang chạy...`;
            btnStop.disabled = false;
            lucide.createIcons();
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            // Stop local stream if exists
            const activeStream = localVideo.srcObject || mainVideo.srcObject;
            if (activeStream) {
                const tracks = activeStream.getTracks();
                tracks.forEach(track => track.stop());
                localVideo.srcObject = null;
                mainVideo.srcObject = null;
            }
            mainVideo.src = '';
            mainVideo.style.display = 'block';
            localVideo.style.display = 'none';

            // UI Feedback
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
