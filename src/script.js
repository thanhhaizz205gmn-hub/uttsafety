/* ═══════════════════════════════════════════════════════════
   UTT AI SAFETY — script.js (Live Test Optimization)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ─── App State ────────────────────────────────────────────────────────
    const appState = {
        activePage: 'home',
        notifCount: 0,
        gridCount: 4,
        isDarkMode: false,
        filters: { helmet: true, vest: true, pose: true },
        isCameraActive: false
    };

    // ─── DOM Elements ─────────────────────────────────────────────────────
    const sections = document.querySelectorAll('.page-section');
    const navItems = document.querySelectorAll('.nav-item');
    const cameraGrid = document.getElementById('camera-grid-main');
    const camCountSelect = document.getElementById('cam-count-select');
    const notifBadge = document.getElementById('notif-count');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const yoloStatusText = document.getElementById('yolo-status-text');
    
    // Main Camera Elements
    const mainVideo = document.getElementById('main-video');
    const videoWebcam = document.getElementById('webcam');
    
    // Audio
    const ppeAudio = document.getElementById('audio-warning');
    const alarmAudio = document.getElementById('audio-alarm');

    // ─── Page Switching Logic ─────────────────────────────────────────────
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const target = item.getAttribute('data-target');
            if (!target) return;
            e.preventDefault();

            // Update UI
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            sections.forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${target}`).classList.add('active');
            
            appState.activePage = target;
            if (target === 'home') initGrid();
        });
    });

    // ─── Camera Grid Management ───────────────────────────────────────────
    function initGrid() {
        const count = parseInt(camCountSelect.value);
        appState.gridCount = count;
        
        // Update Grid CSS Class
        cameraGrid.className = `camera-grid grid-${count}`;
        
        // Keep primary cam card, remove others
        const primaryCard = document.getElementById('primary-cam-card');
        cameraGrid.innerHTML = '';
        cameraGrid.appendChild(primaryCard);

        // Add Placeholder Cards
        for (let i = 2; i <= count; i++) {
            const card = document.createElement('div');
            card.className = 'camera-card';
            card.innerHTML = `
                <div class="cam-info-top"><span class="cam-tag">CAM 0${i}</span></div>
                <div class="stream-container placeholder">
                    <div style="color:var(--text-muted); font-size:0.7rem; text-align:center;">
                        <i data-lucide="video-off"></i><br>No Signal
                    </div>
                </div>
            `;
            cameraGrid.appendChild(card);
        }
        lucide.createIcons();
        setupEnlargeLogic();
    }

    camCountSelect.addEventListener('change', initGrid);

    function setupEnlargeLogic() {
        document.querySelectorAll('.camera-card').forEach(card => {
            card.addEventListener('dblclick', () => {
                card.classList.toggle('enlarged');
            });
            // Also support expand button
            const btn = card.querySelector('.btn-expand');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    card.classList.toggle('enlarged');
                });
            }
        });
    }

    // ─── Dark Mode Toggle ─────────────────────────────────────────────────
    darkModeToggle.addEventListener('change', () => {
        appState.isDarkMode = darkModeToggle.checked;
        document.documentElement.setAttribute('data-theme', appState.isDarkMode ? 'dark' : 'light');
        localStorage.setItem('theme', appState.isDarkMode ? 'dark' : 'light');
    });

    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        darkModeToggle.checked = true;
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // ─── AI Notification & Alert Logic ────────────────────────────────────
    let lastLogTime = "";

    async function fetchSystemData() {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            const logs = data.logs || [];

            if (logs.length > 0) {
                const latestLog = logs[0];
                if (latestLog.time !== lastLogTime) {
                    lastLogTime = latestLog.time;
                    processAlert(latestLog);
                }
                updateStatsTable(logs);
            }
        } catch (e) {
            console.error("Fetch error:", e);
        }
    }

    function processAlert(log) {
        // Read filters
        const helmet = document.getElementById('filter-helmet').checked;
        const vest = document.getElementById('filter-vest').checked;
        const pose = document.getElementById('filter-pose').checked;

        let triggered = false;
        if (log.type === 'PPE') {
            if (log.detail.includes('mũ') && helmet) triggered = true;
            if (log.detail.includes('áo') && vest) triggered = true;
        } else if (log.type === 'ROI' && pose) {
            triggered = true;
        }

        if (triggered) {
            // Update Badge
            appState.notifCount++;
            notifBadge.textContent = appState.notifCount;
            notifBadge.classList.add('pulse');
            setTimeout(() => notifBadge.classList.remove('pulse'), 500);

            // Audio Alert
            if (log.type === 'PPE') ppeAudio.play().catch(() => {});
            else alarmAudio.play().catch(() => {});

            // Visual indicator
            const indicator = document.getElementById('ai-status-indicator');
            indicator.style.background = 'var(--danger)';
            setTimeout(() => indicator.style.background = 'var(--primary)', 2000);
        }
    }

    function updateStatsTable(logs) {
        const tableBody = document.getElementById('stats-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = logs.slice(0, 10).map(log => `
            <tr>
                <td>${log.time}</td>
                <td>CAM 01</td>
                <td><span class="badge-${log.type === 'PPE' ? 'warning' : 'danger'}">${log.type}: ${log.detail}</span></td>
            </tr>
        `).join('');
    }

    setInterval(fetchSystemData, 1500);

    // ─── Camera & Device Compatibility ────────────────────────────────────
    async function startCamera() {
        // Release previous tracks
        if (videoWebcam.srcObject) {
            videoWebcam.srcObject.getTracks().forEach(t => t.stop());
        }

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
            videoWebcam.srcObject = stream;
            await videoWebcam.play();
            yoloStatusText.textContent = "SYSTEM ACTIVE";
            appState.isCameraActive = true;
        } catch (err) {
            console.error("Camera Error:", err);
            let msg = "Lỗi Camera: " + err.name;
            if (err.name === 'NotReadableError') msg = "Camera đang bị kẹt. Hãy đóng các app khác và nhấn vào logo Robot để thử lại.";
            alert(msg);
            yoloStatusText.textContent = "CAMERA ERROR";
        }
    }

    // AI Indicator acts as a manual camera trigger/retry
    document.getElementById('ai-status-indicator').addEventListener('click', startCamera);

    // ─── AI Model Loader (Mock/Placeholder for ONNX) ──────────────────────
    async function loadModel() {
        try {
            // Simulated ONNX load
            console.log("Model loading...");
            // if (window.ort) { ... }
            setTimeout(() => {
                yoloStatusText.textContent = "AI READY";
                startCamera(); // Auto start camera on load
            }, 2000);
        } catch (e) {
            yoloStatusText.textContent = "LOAD ERROR";
        }
    }

    // Initialize
    initGrid();
    loadModel();
});
