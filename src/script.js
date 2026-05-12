/* ═══════════════════════════════════════════════════════════
   UTT AI SAFETY — script.js (Full AI Pipeline + Live Test)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ─── App State ────────────────────────────────────────────────────────
    const appState = {
        notifCount: 0,
        gridCount: 4,
        isDarkMode: false,
        filters: { helmet: true, vest: true, pose: true },
        isCameraActive: false,
        activeCamera: { id: '1', name: 'CAM 01 - Khu vực A' },
        lastLogTime: ""
    };

    // ─── DOM Elements ─────────────────────────────────────────────────────
    const sections      = document.querySelectorAll('.page-section');
    const navItems      = document.querySelectorAll('.nav-item[data-target]');
    const cameraGrid    = document.getElementById('camera-grid-main');
    const camCountSelect = document.getElementById('cam-count-select');
    const notifBadge    = document.getElementById('notif-count');
    const darkToggle    = document.getElementById('dark-mode-toggle');
    const yoloStatusText = document.getElementById('yolo-status-text');
    const mainVideo     = document.getElementById('main-video');
    const videoWebcam   = document.getElementById('webcam');
    const aiStatusBtn   = document.getElementById('ai-status-indicator');
    const ppeAudio      = document.getElementById('audio-warning');
    const alarmAudio    = document.getElementById('audio-alarm');

    // ─── SPA Navigation ───────────────────────────────────────────────────
    navItems.forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const target = item.getAttribute('data-target');
            if (!target) return;

            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            sections.forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${target}`).classList.add('active');

            if (target === 'system') loadCameraList();
        });
    });

    // ─── Camera Grid Management ───────────────────────────────────────────
    function initGrid() {
        const count = parseInt(camCountSelect.value);
        appState.gridCount = count;
        cameraGrid.className = `camera-grid grid-${count}`;

        const primaryCard = document.getElementById('primary-cam-card');
        cameraGrid.innerHTML = '';
        cameraGrid.appendChild(primaryCard);

        for (let i = 2; i <= count; i++) {
            const card = document.createElement('div');
            card.className = 'camera-card';
            card.setAttribute('data-cam-id', `cam-0${i}`);
            card.innerHTML = `
                <div class="cam-info-top">
                    <span class="cam-tag">CAM 0${i}</span>
                    <span class="ai-indicator offline" title="Chờ tín hiệu"></span>
                </div>
                <div class="stream-container placeholder">
                    <div style="color:var(--text-muted);font-size:0.7rem;text-align:center">
                        <i data-lucide="video-off"></i><br>No Signal
                    </div>
                </div>`;
            cameraGrid.appendChild(card);
        }

        lucide.createIcons();
        setupCardInteractions();
    }

    camCountSelect.addEventListener('change', initGrid);

    function setupCardInteractions() {
        document.querySelectorAll('.camera-card').forEach(card => {
            // Double-click to fullscreen
            card.addEventListener('dblclick', () => {
                card.classList.toggle('enlarged');
            });
            const expandBtn = card.querySelector('.btn-expand');
            if (expandBtn) {
                expandBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    card.classList.toggle('enlarged');
                });
            }
        });
    }

    // ─── Dark Mode ────────────────────────────────────────────────────────
    function applyTheme(dark) {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        localStorage.setItem('theme', dark ? 'dark' : 'light');
    }
    darkToggle.addEventListener('change', () => applyTheme(darkToggle.checked));
    if (localStorage.getItem('theme') === 'dark') {
        darkToggle.checked = true;
        applyTheme(true);
    }

    // ─── Camera System ────────────────────────────────────────────────────
    function setAIIndicator(cardEl, status) {
        // status: 'active' | 'error' | 'offline'
        let dot = cardEl.querySelector('.ai-indicator');
        if (!dot) return;
        dot.className = `ai-indicator ${status}`;
        dot.title = status === 'active' ? 'AI đang xử lý' : status === 'error' ? 'Lỗi model' : 'Ngoại tuyến';
    }

    function stopAllTracks() {
        if (videoWebcam.srcObject) {
            videoWebcam.srcObject.getTracks().forEach(t => t.stop());
            videoWebcam.srcObject = null;
        }
    }

    async function startCamera() {
        stopAllTracks();
        yoloStatusText.textContent = "CONNECTING...";
        aiStatusBtn.style.background = '#ff9500';

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const constraints = {
            video: {
                facingMode: isMobile ? 'environment' : 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            mainVideo.style.display = 'none';
            videoWebcam.style.display = 'block';
            videoWebcam.style.width = '100%';
            videoWebcam.style.height = '100%';
            videoWebcam.style.objectFit = 'cover';
            videoWebcam.srcObject = stream;
            await videoWebcam.play();

            appState.isCameraActive = true;
            yoloStatusText.textContent = "SYSTEM ACTIVE";
            aiStatusBtn.style.background = 'var(--success, #34c759)';

            const primaryCard = document.getElementById('primary-cam-card');
            setAIIndicator(primaryCard, 'active');
        } catch (err) {
            console.error("Camera Error:", err);
            yoloStatusText.textContent = "CAMERA ERROR";
            aiStatusBtn.style.background = 'var(--danger, #ff3b30)';

            const primaryCard = document.getElementById('primary-cam-card');
            setAIIndicator(primaryCard, 'error');

            let msg = "Lỗi Camera: " + err.name;
            if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                msg = "📵 Camera đang bị ứng dụng khác chiếm dụng.\nHãy đóng FaceTime, Zoom... và nhấn Robot để thử lại.";
            } else if (err.name === 'NotAllowedError') {
                msg = "🔒 Cần cấp quyền Camera trong Cài đặt → Safari → Camera.";
            }
            alert(msg);
        }
    }

    // Robot AI button = manual camera retry
    aiStatusBtn.addEventListener('click', startCamera);

    // ─── System Camera List ───────────────────────────────────────────────
    async function loadCameraList() {
        const container = document.getElementById('system-cam-list');
        if (!container) return;
        container.innerHTML = '<p style="padding:20px;color:var(--text-muted)">Đang tải...</p>';

        try {
            const res = await fetch('/api/cameras');
            const cameras = await res.json();

            container.innerHTML = cameras.map(cam => `
                <div class="cam-list-item glass" data-cam-id="${cam.id}" style="display:flex;align-items:center;gap:15px;padding:16px;margin-bottom:10px;cursor:pointer;border-radius:16px;">
                    <div class="ai-indicator ${cam.status === 'online' ? 'active' : cam.status === 'available' ? 'offline' : 'error'}" style="flex-shrink:0"></div>
                    <div>
                        <strong>${cam.name}</strong><br>
                        <small style="color:var(--text-muted)">${cam.status.toUpperCase()}</small>
                    </div>
                    <i data-lucide="chevron-right" style="margin-left:auto;color:var(--text-muted)"></i>
                </div>
            `).join('');

            lucide.createIcons();

            // Click to switch stream
            container.querySelectorAll('.cam-list-item').forEach(item => {
                item.addEventListener('click', () => {
                    const camId = item.getAttribute('data-cam-id');
                    const camName = item.querySelector('strong').textContent;
                    appState.activeCamera = { id: camId, name: camName };

                    // Switch backend stream
                    mainVideo.src = `/video_feed/${camId}`;
                    mainVideo.style.display = 'block';
                    videoWebcam.style.display = 'none';
                    stopAllTracks();
                    yoloStatusText.textContent = `${camName}`;
                });
            });
        } catch (e) {
            container.innerHTML = '<p style="padding:20px;color:var(--danger)">Không thể kết nối server</p>';
        }
    }

    // ─── AI Filter Logic ──────────────────────────────────────────────────
    function getFilters() {
        return {
            helmet: document.getElementById('filter-helmet')?.checked ?? true,
            vest:   document.getElementById('filter-vest')?.checked ?? true,
            pose:   document.getElementById('filter-pose')?.checked ?? true
        };
    }

    // ─── Real-time Log Polling & Notification ─────────────────────────────
    async function fetchLogs() {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            const logs = data.logs || [];

            if (logs.length > 0 && logs[0].time !== appState.lastLogTime) {
                const latestLog = logs[0];
                appState.lastLogTime = latestLog.time;
                processAlert(latestLog);
            }

            updateStatsTable(logs);
        } catch (e) {
            console.warn("Log fetch error:", e);
        }
    }

    function processAlert(log) {
        const filters = getFilters();

        let shouldAlert = false;
        if ((log.type === 'PPE') && 
            ((log.detail.toLowerCase().includes('helmet') && filters.helmet) ||
             (log.detail.toLowerCase().includes('vest') && filters.vest))) {
            shouldAlert = true;
        } else if (log.type === 'FALL' && filters.pose) {
            shouldAlert = true;
        } else if (log.type === 'ROI') {
            shouldAlert = true;
        }

        if (!shouldAlert) return;

        // 1. Tăng Badge thông báo
        appState.notifCount++;
        notifBadge.textContent = appState.notifCount;
        notifBadge.style.transform = 'scale(1.5)';
        setTimeout(() => notifBadge.style.transform = 'scale(1)', 300);

        // 2. Phát âm thanh theo loại vi phạm
        if (log.type === 'FALL') {
            alarmAudio?.play().catch(() => {});
        } else {
            ppeAudio?.play().catch(() => {});
        }

        // 3. Đổi màu Robot AI → đỏ nhấp nháy
        aiStatusBtn.style.background = 'var(--danger, #ff3b30)';
        setTimeout(() => aiStatusBtn.style.background = 'var(--primary, #007aff)', 3000);

        // 4. Browser Push Notification
        if (Notification.permission === 'granted') {
            new Notification(`🚨 ${log.type} - ${appState.activeCamera.name}`, {
                body: `${log.detail} | ID: ${log.id}`,
                icon: 'assets/icons/icon-192x192.png'
            });
        }
    }

    function updateStatsTable(logs) {
        const tbody = document.getElementById('stats-table-body');
        if (!tbody) return;

        tbody.innerHTML = logs.slice(0, 15).map(log => {
            const filters = getFilters();
            // Filter display based on user selection
            const isHelmetViolation = log.type === 'PPE' && log.detail.toLowerCase().includes('helmet') && !filters.helmet;
            const isVestViolation   = log.type === 'PPE' && log.detail.toLowerCase().includes('vest') && !filters.vest;
            const isFallViolation   = log.type === 'FALL' && !filters.pose;
            if (isHelmetViolation || isVestViolation || isFallViolation) return '';

            const badgeClass = log.type === 'PPE' ? 'badge-warning' : log.type === 'FALL' ? 'badge-fall' : 'badge-danger';
            const camLabel = log.camera || appState.activeCamera.name;

            return `<tr>
                <td>${log.time}</td>
                <td style="font-size:0.75rem;font-weight:600">${camLabel}</td>
                <td><span class="${badgeClass}">${log.type}: ${log.detail}</span></td>
            </tr>`;
        }).join('');
    }

    // ─── Backend Stream (MJPEG) Switcher ─────────────────────────────────
    function connectToBackendStream(camId) {
        stopAllTracks();
        mainVideo.style.display = 'block';
        videoWebcam.style.display = 'none';
        mainVideo.src = `/video_feed/${camId}`;
        yoloStatusText.textContent = `CAM ${camId} - AI ACTIVE`;
        aiStatusBtn.style.background = 'var(--success, #34c759)';
    }

    // ─── Initialization ───────────────────────────────────────────────────
    function init() {
        initGrid();

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // Auto-start backend stream (server-side AI)
        connectToBackendStream('1');

        // Poll logs every 1.5s
        setInterval(fetchLogs, 1500);
    }

    init();
});
