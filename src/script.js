/* ═══════════════════════════════════════════════════════════
   UTT AI SAFETY — script.js (Advanced Compliance Monitoring)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    const appState = {
        notifCount: 0,
        filters: { helmet: true, vest: true, pose: true },
        isCameraActive: false,
        activeCamera: { id: '1', name: 'Hệ thống A1' },
        modelLoaded: false,
        inferenceRunning: false,
        lastAlertTime: 0
    };

    let sessionPPE = null, sessionFall = null, animFrameId = null;
    const PPE_CLASSES = ['helmet', 'person', 'vest'];
    const FALL_CLASSES = ['fall', 'person'];

    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = 640; inputCanvas.height = 640;
    const inputCtx = inputCanvas.getContext('2d');

    const notifBadge     = document.getElementById('notif-count');
    const notifBtn       = document.getElementById('btn-notifications');
    const yoloStatusText = document.getElementById('yolo-status-text');
    const videoWebcam    = document.getElementById('webcam');
    const aiStatusBtn    = document.getElementById('ai-status-indicator');
    const ppeAudio       = document.getElementById('audio-warning');
    const alarmAudio     = document.getElementById('audio-alarm');

    let overlayCanvas = null, overlayCtx = null;

    function setupOverlayCanvas() {
        const streamContainer = document.querySelector('.stream-container');
        if (!streamContainer || overlayCanvas) return;
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
        streamContainer.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');
    }

    // ─── PHÉP TOÁN SO KHỚP VỊ TRÍ (OVERLAP LOGIC) ────────────────────────
    function getOverlapRatio(boxA, boxB) {
        const x1 = Math.max(boxA.x1, boxB.x1);
        const y1 = Math.max(boxA.y1, boxB.y1);
        const x2 = Math.min(boxA.x2, boxB.x2);
        const y2 = Math.min(boxA.y2, boxB.y2);
        
        if (x2 <= x1 || y2 <= y1) return 0;
        const intersectionArea = (x2 - x1) * (y2 - y1);
        const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
        return intersectionArea / areaA; 
    }

    // ─── KIỂM TRA TUÂN THỦ AN TOÀN (COMPLIANCE CHECK) ────────────────────
    function checkSafetyCompliance(ppeResults, fallResults) {
        const filters = {
            helmet: document.getElementById('filter-helmet')?.checked,
            vest:   document.getElementById('filter-vest')?.checked,
            pose:   document.getElementById('filter-pose')?.checked
        };

        const persons = ppeResults.filter(d => d.className === 'person');
        const helmets = ppeResults.filter(d => d.className === 'helmet');
        const vests   = ppeResults.filter(d => d.className === 'vest');
        const falls   = fallResults.filter(d => d.className === 'fall' || d.className === 'down');

        let currentViolators = 0;
        let reasons = [];

        persons.forEach(person => {
            let hasHelmet = helmets.some(h => getOverlapRatio(h, person) > 0.1);
            let hasVest   = vests.some(v => getOverlapRatio(v, person) > 0.1);

            if (filters.helmet && !hasHelmet) {
                currentViolators++;
                reasons.push("Không đội mũ");
            } else if (filters.vest && !hasVest) {
                currentViolators++;
                reasons.push("Không mặc áo");
            }
        });

        if (filters.pose && falls.length > 0) {
            currentViolators += falls.length;
            reasons.push("PHÁT HIỆN NGÃ");
        }

        if (currentViolators > 0) {
            triggerSafetyAlarm(currentViolators, reasons[0]);
        } else {
            clearSafetyAlarm();
        }
    }

    function triggerSafetyAlarm(count, detail) {
        const now = Date.now();
        const camCard = document.getElementById('primary-cam-card');
        
        // Hiệu ứng nháy đỏ Camera
        if (camCard) camCard.classList.add('flash-red');

        // Hiệu ứng Chuông rung
        if (notifBtn) notifBtn.classList.add('bell-shake');

        // Tần suất báo động (Cooldown 3s)
        if (now - appState.lastAlertTime > 3000) {
            appState.lastAlertTime = now;
            appState.notifCount += count;
            if (notifBadge) {
                notifBadge.textContent = appState.notifCount;
                notifBadge.classList.add('pulse');
            }

            // Âm thanh & Rung
            if (detail.includes("NGÃ")) alarmAudio?.play().catch(() => {});
            else ppeAudio?.play().catch(() => {});
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);

            // Ghi log
            insertLog(detail, count);
        }
    }

    function clearSafetyAlarm() {
        const camCard = document.getElementById('primary-cam-card');
        if (camCard) camCard.classList.remove('flash-red');
        if (notifBtn) notifBtn.classList.remove('bell-shake');
        if (notifBadge) notifBadge.classList.remove('pulse');
    }

    function insertLog(detail, count) {
        const tbody = document.getElementById('stats-table-body');
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.className = 'new-log-flash';
        tr.innerHTML = `
            <td>${new Date().toLocaleTimeString('vi-VN')}</td>
            <td>${appState.activeCamera.name}</td>
            <td><span class="badge-danger">${detail} (${count})</span></td>
        `;
        tbody.prepend(tr);
        if (tbody.rows.length > 15) tbody.deleteRow(15);
    }

    // ─── Inference Engine ────────────────────────────────────────────────
    async function startInference() {
        if (appState.inferenceRunning) return;
        appState.inferenceRunning = true;
        
        async function run() {
            if (!appState.isCameraActive) return;
            try {
                const rect = videoWebcam.getBoundingClientRect();
                if (overlayCanvas) { overlayCanvas.width = rect.width; overlayCanvas.height = rect.height; }

                inputCtx.drawImage(videoWebcam, 0, 0, 640, 640);
                const tensor = preprocess(inputCtx.getImageData(0, 0, 640, 640));

                const [ppeOut, fallOut] = await Promise.all([
                    sessionPPE.run({ [sessionPPE.inputNames[0]]: tensor }),
                    sessionFall.run({ [sessionFall.inputNames[0]]: tensor })
                ]);

                const ppeResults = postprocess(ppeOut[sessionPPE.outputNames[0]].data, PPE_CLASSES);
                const fallResults = postprocess(fallOut[sessionFall.outputNames[0]].data, FALL_CLASSES);

                draw(ppeResults, fallResults);
                checkSafetyCompliance(ppeResults, fallResults);
            } catch (e) {}
            animFrameId = requestAnimationFrame(run);
        }
        run();
    }

    function preprocess(imgData) {
        const float32 = new Float32Array(3 * 640 * 640);
        for (let i = 0; i < 640 * 640; i++) {
            float32[i] = imgData.data[i * 4] / 255;
            float32[i + 640*640] = imgData.data[i * 4 + 1] / 255;
            float32[i + 2*640*640] = imgData.data[i * 4 + 2] / 255;
        }
        return new ort.Tensor('float32', float32, [1, 3, 640, 640]);
    }

    function postprocess(rawData, classNames) {
        const boxes = [];
        for (let i = 0; i < 8400; i++) {
            let maxC = 0, maxI = 0;
            for (let c = 0; c < classNames.length; c++) {
                const s = rawData[(4 + c) * 8400 + i];
                if (s > maxC) { maxC = s; maxI = c; }
            }
            if (maxC < 0.4) continue;
            const cx = rawData[0 * 8400 + i], cy = rawData[1 * 8400 + i], w = rawData[2 * 8400 + i], h = rawData[3 * 8400 + i];
            boxes.push({ x1: (cx - w/2)/640, y1: (cy - h/2)/640, x2: (cx + w/2)/640, y2: (cy + h/2)/640, conf: maxC, className: classNames[maxI] });
        }
        return nms(boxes);
    }

    function nms(boxes) {
        boxes.sort((a, b) => b.conf - a.conf);
        const kept = [];
        const suppressed = new Set();
        for (let i = 0; i < boxes.length; i++) {
            if (suppressed.has(i)) continue;
            kept.push(boxes[i]);
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1), ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
                const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
                const iou = inter / ((a.x2 - a.x1)*(a.y2 - a.y1) + (b.x2 - b.x1)*(b.y2 - b.y1) - inter);
                if (iou > 0.45) suppressed.add(j);
            }
        }
        return kept;
    }

    function draw(ppe, fall) {
        if (!overlayCtx) return;
        const W = overlayCanvas.width, H = overlayCanvas.height;
        overlayCtx.clearRect(0, 0, W, H);
        [...ppe, ...fall].forEach(d => {
            overlayCtx.strokeStyle = d.className === 'person' ? '#007aff' : (d.className.includes('fall') ? '#ff3b30' : '#34c759');
            overlayCtx.lineWidth = 2;
            overlayCtx.strokeRect(d.x1 * W, d.y1 * H, (d.x2 - d.x1) * W, (d.y2 - d.y1) * H);
        });
    }

    // ─── App Bootstrap ───────────────────────────────────────────────────
    async function init() {
        yoloStatusText.textContent = "NẠP MODEL...";
        try {
            sessionPPE = await ort.InferenceSession.create('./models/best.onnx', { executionProviders: ['wasm'] });
            sessionFall = await ort.InferenceSession.create('./models/tuthenga.onnx', { executionProviders: ['wasm'] });
            appState.modelLoaded = true;
            yoloStatusText.textContent = "HỆ THỐNG SẴN SÀNG";
            
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } });
            videoWebcam.srcObject = stream;
            await videoWebcam.play();
            appState.isCameraActive = true;
            setupOverlayCanvas();
            startInference();
        } catch (e) { yoloStatusText.textContent = "LỖI HỆ THỐNG"; }
    }

    init();
});
