/* ═══════════════════════════════════════════════════════════
   UTT AI SAFETY — script.js (Real ONNX Inference Pipeline)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    // ─── App State ────────────────────────────────────────────────────────
    const appState = {
        notifCount: 0,
        gridCount: 4,
        filters: { helmet: true, vest: true, pose: true },
        isCameraActive: false,
        activeCamera: { id: '1', name: 'CAM 01' },
        lastLogTime: "",
        modelLoaded: false,
        inferenceRunning: false
    };

    // ─── ONNX Model Sessions (3 models) ──────────────────────────────────
    let sessionPPE  = null;     // best.onnx      → Helmet, Person, Vest
    let sessionCone = null;     // bestcone.onnx  → traffic_cone, Sign
    let sessionFall = null;     // tuthenga.onnx  → Fall (KHÔNG có person)
    let animFrameId = null;

    // Class labels — đúng thứ tự index trong file .onnx đã export
    const PPE_CLASSES  = ['helmet', 'person', 'vest'];   // best.onnx output shape [1, 7, 8400]
    const CONE_CLASSES = ['traffic_cone', 'sign'];        // bestcone.onnx output shape [1, 6, 8400]
    const FALL_CLASSES = ['fall'];                        // tuthenga.onnx — KHÔNG có class person

    // Canvas cho inference
    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = 640;
    inputCanvas.height = 640;
    const inputCtx = inputCanvas.getContext('2d');

    // ─── DOM Elements ─────────────────────────────────────────────────────
    const sections = document.querySelectorAll('.page-section');
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const cameraGrid = document.getElementById('camera-grid-main');
    const camCountSelect = document.getElementById('cam-count-select');
    const notifBadge = document.getElementById('notif-count');
    const darkToggle = document.getElementById('dark-mode-toggle');
    const yoloStatusText = document.getElementById('yolo-status-text');
    const mainVideo = document.getElementById('main-video');
    const videoWebcam = document.getElementById('webcam');
    const aiStatusBtn = document.getElementById('ai-status-indicator');
    const ppeAudio = document.getElementById('audio-warning');
    const alarmAudio = document.getElementById('audio-alarm');

    // Overlay canvas để vẽ bounding box
    let overlayCanvas = null;
    let overlayCtx = null;

    function setupOverlayCanvas() {
        const streamContainer = document.querySelector('.stream-container');
        if (!streamContainer) return;
        if (overlayCanvas) return; // Already set up

        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        streamContainer.style.position = 'relative';
        streamContainer.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');
    }

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

    // ─── Camera Grid ──────────────────────────────────────────────────────
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
            card.innerHTML = `
                <div class="cam-info-top">
                    <span class="cam-tag">CAM 0${i}</span>
                    <span class="ai-indicator offline"></span>
                </div>
                <div class="stream-container placeholder" style="display:flex;align-items:center;justify-content:center;background:#111;">
                    <div style="color:#555;font-size:.7rem;text-align:center;">
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
            card.addEventListener('dblclick', () => card.classList.toggle('enlarged'));
            const btn = card.querySelector('.btn-expand');
            if (btn) btn.addEventListener('click', e => { e.stopPropagation(); card.classList.toggle('enlarged'); });
        });
    }

    // ─── Dark Mode ────────────────────────────────────────────────────────
    function applyTheme(dark) {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        localStorage.setItem('theme', dark ? 'dark' : 'light');
    }
    if (darkToggle) darkToggle.addEventListener('change', () => applyTheme(darkToggle.checked));
    if (localStorage.getItem('theme') === 'dark') {
        if (darkToggle) darkToggle.checked = true;
        applyTheme(true);
    }

    // ─── AI Indicator ─────────────────────────────────────────────────────
    function setIndicator(status, text) {
        // status: 'active' | 'error' | 'offline'
        if (yoloStatusText) yoloStatusText.textContent = text;
        if (aiStatusBtn) {
            aiStatusBtn.style.background = status === 'active'
                ? 'var(--success, #34c759)'
                : status === 'error'
                    ? 'var(--danger, #ff3b30)'
                    : '#ff9500';
        }
        const dot = document.querySelector('#primary-cam-card .ai-indicator');
        if (dot) dot.className = `ai-indicator ${status}`;
    }

    // ─── ONNX Model Loader ────────────────────────────────────────────────
    async function loadModels() {
        if (!window.ort) {
            setIndicator('error', 'ORT NOT FOUND');
            console.error("ONNX Runtime not loaded. Check index.html script tag.");
            return;
        }

        setIndicator('offline', 'LOADING PPE...');
        try {
            // Tải best.onnx (Helmet + Vest detection)
            sessionPPE = await ort.InferenceSession.create('./models/best.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            console.log('[AI] best.onnx loaded. Classes:', PPE_CLASSES);

            setIndicator('offline', 'LOADING CONE...');
            // Tải bestcone.onnx (traffic_cone + sign)
            sessionCone = await ort.InferenceSession.create('./models/bestcone.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            console.log('[AI] bestcone.onnx loaded. Classes:', CONE_CLASSES);

            setIndicator('offline', 'LOADING FALL...');
            // Tải tuthenga.onnx (Fall only — KHÔNG có class person)
            sessionFall = await ort.InferenceSession.create('./models/tuthenga.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            console.log('[AI] tuthenga.onnx loaded. Classes:', FALL_CLASSES);

            appState.modelLoaded = true;
            setIndicator('active', '3 MODELS LOADED');
            console.log('[AI] PPE + Cone + Fall — All ready!');

            // Tự động mở camera sau khi load xong
            await startCamera();
        } catch (err) {
            console.error('[AI] Load failed:', err);
            setIndicator('error', 'MODEL ERROR');
        }
    }

    // ─── Camera Control ────────────────────────────────────────────────────
    function stopAllTracks() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (videoWebcam.srcObject) {
            videoWebcam.srcObject.getTracks().forEach(t => t.stop());
            videoWebcam.srcObject = null;
        }
        if (overlayCtx && overlayCanvas) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        appState.isCameraActive = false;
        appState.inferenceRunning = false;
    }

    async function startCamera() {
        stopAllTracks();
        setIndicator('offline', 'CONNECTING...');

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const constraints = {
            video: { facingMode: isMobile ? 'environment' : 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            mainVideo.style.display = 'none';
            videoWebcam.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;';
            videoWebcam.srcObject = stream;
            await videoWebcam.play();

            appState.isCameraActive = true;
            setupOverlayCanvas();

            if (appState.modelLoaded) {
                setIndicator('active', 'AI RUNNING');
                startInferenceLoop();
            } else {
                setIndicator('active', 'CAM ACTIVE (No Model)');
            }
        } catch (err) {
            console.error('Camera Error:', err);
            let msg = 'Lỗi Camera: ' + err.name;
            if (err.name === 'NotReadableError') msg = '📵 Camera bị chiếm dụng. Đóng app khác và nhấn Robot để thử lại.';
            else if (err.name === 'NotAllowedError') msg = '🔒 Cần cấp quyền Camera trong Cài đặt → Safari → Camera.';
            alert(msg);
            setIndicator('error', 'CAMERA ERROR');
        }
    }

    aiStatusBtn.addEventListener('click', () => {
        if (appState.modelLoaded) startCamera();
        else loadModels();
    });

    // ─── REAL ONNX INFERENCE LOOP ─────────────────────────────────────────
    function startInferenceLoop() {
        if (appState.inferenceRunning) return;
        appState.inferenceRunning = true;

        let frameSkip = 0;
        const SKIP_FRAMES = 3; // Chạy inference mỗi 3 frame (tiết kiệm CPU)

        async function detectFrame() {
            if (!appState.isCameraActive || !appState.modelLoaded) return;

            frameSkip++;
            if (frameSkip < SKIP_FRAMES) {
                animFrameId = requestAnimationFrame(detectFrame);
                return;
            }
            frameSkip = 0;

            if (videoWebcam.readyState < 2) {
                animFrameId = requestAnimationFrame(detectFrame);
                return;
            }

            try {
                // 1. Cập nhật kích thước overlay
                const rect = videoWebcam.getBoundingClientRect();
                if (overlayCanvas) {
                    overlayCanvas.width = rect.width || videoWebcam.videoWidth;
                    overlayCanvas.height = rect.height || videoWebcam.videoHeight;
                }

                // 2. Vẽ frame vào canvas 640x640
                inputCtx.drawImage(videoWebcam, 0, 0, 640, 640);
                const imageData = inputCtx.getImageData(0, 0, 640, 640);

                // 3. Chuẩn bị Tensor [1, 3, 640, 640] - NCHW, normalized 0-1
                const tensor = preprocessFrame(imageData);

                // 4. PPE model: Helmet, Person, Vest (best.onnx)
                const ppeOutput = await sessionPPE.run({ [sessionPPE.inputNames[0]]: tensor });
                const ppeResults = postprocess(ppeOutput[sessionPPE.outputNames[0]].data, PPE_CLASSES);

                // 5. Cone model: traffic_cone, Sign (bestcone.onnx) — KHÔNG có person
                const coneOutput = await sessionCone.run({ [sessionCone.inputNames[0]]: tensor });
                const coneResults = postprocess(coneOutput[sessionCone.outputNames[0]].data, CONE_CLASSES);

                // 6. Fall model: Fall only (tuthenga.onnx) — KHÔNG có person
                const fallOutput = await sessionFall.run({ [sessionFall.inputNames[0]]: tensor });
                const fallResults = postprocess(fallOutput[sessionFall.outputNames[0]].data, FALL_CLASSES);

                // 7. Gộp tất cả kết quả và vẽ Bounding Box
                drawDetections([...ppeResults, ...coneResults, ...fallResults]);

                // 8. Chỉ kiểm tra vi phạm bằng PPE + Fall (Cone không liên quan compliance)
                checkViolations(ppeResults, fallResults);

            } catch (err) {
                console.error('Inference error:', err);
            }

            animFrameId = requestAnimationFrame(detectFrame);
        }

        animFrameId = requestAnimationFrame(detectFrame);
    }

    // ─── Preprocess: ImageData → Float32 Tensor NCHW ─────────────────────
    function preprocessFrame(imageData) {
        const { data, width, height } = imageData; // RGBA, 640x640
        const float32 = new Float32Array(3 * width * height);

        for (let i = 0; i < width * height; i++) {
            float32[i] = data[i * 4] / 255.0; // R
            float32[i + width * height] = data[i * 4 + 1] / 255.0; // G
            float32[i + 2 * width * height] = data[i * 4 + 2] / 255.0; // B
        }

        return new ort.Tensor('float32', float32, [1, 3, height, width]);
    }

    // ─── Postprocess: Tensor output → Bounding Box list ──────────────────
    // YOLOv8 output shape: [1, num_classes+4, 8400]
    function postprocess(rawData, classNames, confThresh = 0.35, iouThresh = 0.45) {
        const numClasses = classNames.length;
        const numBoxes = 8400;
        const detections = [];

        for (let i = 0; i < numBoxes; i++) {
            // Đọc cx, cy, w, h
            const cx = rawData[0 * numBoxes + i];
            const cy = rawData[1 * numBoxes + i];
            const w = rawData[2 * numBoxes + i];
            const h = rawData[3 * numBoxes + i];

            // Tìm class score cao nhất
            let maxConf = 0, maxClass = 0;
            for (let c = 0; c < numClasses; c++) {
                const conf = rawData[(4 + c) * numBoxes + i];
                if (conf > maxConf) { maxConf = conf; maxClass = c; }
            }

            if (maxConf < confThresh) continue;

            detections.push({
                x1: (cx - w / 2) / 640,
                y1: (cy - h / 2) / 640,
                x2: (cx + w / 2) / 640,
                y2: (cy + h / 2) / 640,
                conf: maxConf,
                classId: maxClass,
                className: classNames[maxClass] || 'unknown'
            });
        }

        // NMS đơn giản theo conf
        return nms(detections, iouThresh);
    }

    // ─── NMS (Non-Maximum Suppression) ───────────────────────────────────
    function nms(boxes, iouThresh) {
        boxes.sort((a, b) => b.conf - a.conf);
        const kept = [];
        const suppressed = new Set();

        for (let i = 0; i < boxes.length; i++) {
            if (suppressed.has(i)) continue;
            kept.push(boxes[i]);
            for (let j = i + 1; j < boxes.length; j++) {
                if (iou(boxes[i], boxes[j]) > iouThresh) suppressed.add(j);
            }
        }
        return kept;
    }

    function iou(a, b) {
        const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
        const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
        const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
        const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
        return inter / (aArea + bArea - inter + 1e-6);
    }

    // ─── Draw Bounding Boxes ──────────────────────────────────────────────
    const CLASS_COLORS = {
        helmet: '#34c759', vest: '#34c759', person: '#007aff',
        fall: '#ff3b30', down: '#ff3b30', nga: '#ff9500'
    };

    function drawDetections(detections) {
        if (!overlayCtx || !overlayCanvas) return;
        const W = overlayCanvas.width;
        const H = overlayCanvas.height;
        overlayCtx.clearRect(0, 0, W, H);

        const filters = {
            helmet: document.getElementById('filter-helmet')?.checked,
            vest: document.getElementById('filter-vest')?.checked,
            pose: document.getElementById('filter-pose')?.checked
        };

        detections.forEach(det => {
            // Lọc theo checkbox
            if (det.className === 'helmet' && !filters.helmet) return;
            if (det.className === 'vest' && !filters.vest) return;
            if ((det.className === 'fall' || det.className === 'down') && !filters.pose) return;

            const x1 = det.x1 * W, y1 = det.y1 * H;
            const bw = (det.x2 - det.x1) * W, bh = (det.y2 - det.y1) * H;
            const color = CLASS_COLORS[det.className] || '#ffffff';
            const label = `${det.className} ${(det.conf * 100).toFixed(0)}%`;

            overlayCtx.strokeStyle = color;
            overlayCtx.lineWidth = 2;
            overlayCtx.strokeRect(x1, y1, bw, bh);

            overlayCtx.fillStyle = color;
            overlayCtx.font = 'bold 12px Plus Jakarta Sans, sans-serif';
            overlayCtx.fillRect(x1, y1 - 18, overlayCtx.measureText(label).width + 8, 18);
            overlayCtx.fillStyle = '#fff';
            overlayCtx.fillText(label, x1 + 4, y1 - 4);
        });
    }

    // ─── Spatial Overlap Ratio (kế thừa từ giaodienvtv) ─────────────────
    function getOverlapRatio(boxA, boxB) {
        const x1 = Math.max(boxA.x1, boxB.x1);
        const y1 = Math.max(boxA.y1, boxB.y1);
        const x2 = Math.min(boxA.x2, boxB.x2);
        const y2 = Math.min(boxA.y2, boxB.y2);
        if (x2 <= x1 || y2 <= y1) return 0;
        const interArea = (x2 - x1) * (y2 - y1);
        const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
        return areaA > 0 ? interArea / areaA : 0;
    }

    // ─── Violation Checker (Spatial IoU Matching) ─────────────────────────
    let lastAlertTime = 0;

    function checkViolations(ppeResults, fallResults) {
        const now = Date.now();
        const filters = {
            helmet: document.getElementById('filter-helmet')?.checked,
            vest: document.getElementById('filter-vest')?.checked,
            pose: document.getElementById('filter-pose')?.checked
        };

        const persons = ppeResults.filter(d => d.className === 'person');
        const helmets = ppeResults.filter(d => d.className === 'helmet');
        const vests = ppeResults.filter(d => d.className === 'vest');
        const falls = fallResults.filter(d => d.className === 'fall' || d.className === 'down');

        let violatorCount = 0;
        let violationDetail = null;

        // ─── Logic đối soát từng người theo tọa độ (kế thừa giaodienvtv) ────
        persons.forEach(person => {
            // Kiểm tra: có mũ nào đè lên người này không?
            const hasHelmet = helmets.some(h => getOverlapRatio(h, person) > 0.05);
            // Kiểm tra: có áo nào đè lên người này không?
            const hasVest = vests.some(v => getOverlapRatio(v, person) > 0.10);

            if (filters.helmet && !hasHelmet) {
                violatorCount++;
                if (!violationDetail) violationDetail = { type: 'PPE', detail: 'Thiếu Helmet' };
            } else if (filters.vest && !hasVest) {
                violatorCount++;
                if (!violationDetail) violationDetail = { type: 'PPE', detail: 'Thiếu Vest' };
            }
        });

        // Kiểm tra ngã
        if (filters.pose && falls.length > 0) {
            violatorCount += falls.length;
            violationDetail = { type: 'FALL', detail: `Phát hiện ${falls.length} người ngã` };
        }

        if (violatorCount > 0 && violationDetail) {
            if (now - lastAlertTime > 5000) { // Cooldown 5 giây
                lastAlertTime = now;
                triggerAlert(violationDetail.type, violationDetail.detail, violatorCount);
            }
            // Luôn bật flash-red trong suốt thời gian vi phạm
            activateAlarmVisuals();
        } else {
            // Tắt hiệu ứng khi không còn vi phạm
            clearAlarmVisuals();
        }
    }

    // ─── Visual Alarm Effects (flash-red + bell-shake) ───────────────────
    function activateAlarmVisuals() {
        const camCard = document.getElementById('primary-cam-card');
        const notifBtn = document.getElementById('btn-notifications');
        if (camCard) camCard.classList.add('flash-red');
        if (notifBtn) notifBtn.classList.add('bell-shake');
        if (notifBadge) notifBadge.classList.add('pulse');
    }

    function clearAlarmVisuals() {
        const camCard = document.getElementById('primary-cam-card');
        const notifBtn = document.getElementById('btn-notifications');
        if (camCard) camCard.classList.remove('flash-red');
        if (notifBtn) notifBtn.classList.remove('bell-shake');
        if (notifBadge) notifBadge.classList.remove('pulse');
    }

    function triggerAlert(type, detail, count = 1) {
        // 1. Tăng badge chuông theo số người vi phạm
        appState.notifCount += count;
        if (notifBadge) {
            notifBadge.textContent = appState.notifCount;
        }

        // 2. Kích hoạt hiệu ứng nháy đỏ + rung chuông
        activateAlarmVisuals();

        // 3. Rung điện thoại (Haptic)
        if (navigator.vibrate) navigator.vibrate([300, 100, 300]);

        // 4. Phát âm thanh cảnh báo
        if (type === 'FALL') alarmAudio?.play().catch(() => { });
        else ppeAudio?.play().catch(() => { });

        // 5. Chèn vào bảng thống kê
        const timeStr = new Date().toTimeString().slice(0, 8);
        insertViolationRow({ time: timeStr, camera: appState.activeCamera.name, type, detail });

        // 6. Robot blink đỏ → xanh sau 2s
        if (aiStatusBtn) {
            aiStatusBtn.style.background = 'var(--danger, #ff3b30)';
            setTimeout(() => aiStatusBtn.style.background = 'var(--success, #34c759)', 2000);
        }

        // 7. Push notification (nếu được cấp quyền)
        if (Notification.permission === 'granted') {
            new Notification(`🚨 ${type} - ${appState.activeCamera.name}`, {
                body: `${detail} (${count} người)`,
                icon: 'assets/icons/icon-192x192.png'
            });
        }
    }

    function insertViolationRow(log) {
        const tbody = document.getElementById('stats-table-body');
        if (!tbody) return;
        const badgeClass = log.type === 'FALL' ? 'badge-fall' : 'badge-warning';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${log.time}</td>
            <td style="font-weight:600;font-size:.75rem">${log.camera}</td>
            <td><span class="${badgeClass}">${log.type}: ${log.detail}</span></td>`;
        tbody.prepend(tr);

        // Giới hạn 20 dòng
        while (tbody.rows.length > 20) tbody.deleteRow(tbody.rows.length - 1);
    }

    // ─── System Camera List (API) ─────────────────────────────────────────
    async function loadCameraList() {
        const container = document.getElementById('system-cam-list');
        if (!container) return;
        container.innerHTML = '<p style="padding:20px;color:var(--text-muted)">Đang tải...</p>';
        try {
            const res = await fetch('/api/cameras');
            const cameras = await res.json();
            container.innerHTML = cameras.map(cam => `
                <div class="glass" data-cam-id="${cam.id}" style="display:flex;align-items:center;gap:15px;padding:16px;margin-bottom:10px;cursor:pointer;border-radius:16px;">
                    <div class="ai-indicator ${cam.status === 'online' ? 'active' : 'offline'}"></div>
                    <div><strong>${cam.name}</strong><br><small style="color:var(--text-muted)">${cam.status}</small></div>
                    <i data-lucide="chevron-right" style="margin-left:auto;color:var(--text-muted)"></i>
                </div>`).join('');
            lucide.createIcons();
        } catch (e) {
            container.innerHTML = '<p style="padding:20px;color:var(--danger)">Không thể kết nối server</p>';
        }
    }

    // ─── API Polling (khi dùng backend) ──────────────────────────────────
    async function fetchLogs() {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            const logs = data.logs || [];
            if (logs.length > 0 && logs[0].time !== appState.lastLogTime) {
                appState.lastLogTime = logs[0].time;
                // Chỉ hiển thị lên bảng (không trigger alert thêm lần nữa)
                updateStatsFromAPI(logs);
            }
        } catch (e) { /* Backend offline - dùng ONNX local */ }
    }

    function updateStatsFromAPI(logs) {
        const tbody = document.getElementById('stats-table-body');
        if (!tbody || tbody.rows.length > 5) return; // Ưu tiên kết quả từ ONNX local
        logs.slice(0, 10).forEach(log => {
            const badgeClass = log.type === 'FALL' ? 'badge-fall' : log.type === 'ROI' ? 'badge-danger' : 'badge-warning';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${log.time}</td>
                <td style="font-weight:600;font-size:.75rem">${log.camera || 'CAM 01'}</td>
                <td><span class="${badgeClass}">${log.type}: ${log.detail}</span></td>`;
            tbody.appendChild(tr);
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────
    function init() {
        initGrid();
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        // Load ONNX models → tự động mở camera sau khi load xong
        loadModels();
        // Poll backend logs song song (nếu có)
        setInterval(fetchLogs, 3000);
    }

    init();
});
