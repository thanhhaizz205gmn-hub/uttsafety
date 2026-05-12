/* ═══════════════════════════════════════════════════════════
   UTT AI SAFETY — script.js (Safety Compliance Logic)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {

    const appState = {
        notifCount: 0,
        filters: { helmet: true, vest: true, pose: true },
        isCameraActive: false,
        activeCamera: { id: '1', name: 'CAM 01' },
        lastLogTime: "",
        modelLoaded: false,
        inferenceRunning: false
    };

    let sessionPPE = null, sessionFall = null, animFrameId = null;
    const PPE_CLASSES = ['helmet', 'person', 'vest'];
    const FALL_CLASSES = ['fall', 'person'];

    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = 640; inputCanvas.height = 640;
    const inputCtx = inputCanvas.getContext('2d');

    const notifBadge     = document.getElementById('notif-count');
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

    // ─── Hàm kiểm tra giao nhau (Matching PPE to Person) ──────────────────
    function isInside(boxA, boxB) {
        // Kiểm tra xem tâm của boxA có nằm trong boxB không
        const cx = (boxA.x1 + boxA.x2) / 2;
        const cy = (boxA.y1 + boxA.y2) / 2;
        return (cx >= boxB.x1 && cx <= boxB.x2 && cy >= boxB.y1 && cy <= boxB.y2);
    }

    // ─── Logic đối soát an toàn ──────────────────────────────────────────
    function checkViolations(ppeResults, fallResults) {
        const filters = {
            helmet: document.getElementById('filter-helmet')?.checked,
            vest:   document.getElementById('filter-vest')?.checked,
            pose:   document.getElementById('filter-pose')?.checked
        };

        const persons = ppeResults.filter(d => d.className === 'person');
        const helmets = ppeResults.filter(d => d.className === 'helmet');
        const vests   = ppeResults.filter(d => d.className === 'vest');
        const falls   = fallResults.filter(d => d.className === 'fall' || d.className === 'down');

        let frameViolators = 0;
        let violationDetails = [];

        persons.forEach(person => {
            let hasHelmet = helmets.some(h => isInside(h, person));
            let hasVest = vests.some(v => isInside(v, person));

            let pViolation = false;
            if (filters.helmet && !hasHelmet) {
                pViolation = true;
                violationDetails.push("Thiếu Mũ");
            }
            if (filters.vest && !hasVest) {
                pViolation = true;
                violationDetails.push("Thiếu Áo");
            }

            if (pViolation) frameViolators++;
        });

        // Kiểm tra ngã (Fall)
        if (filters.pose && falls.length > 0) {
            frameViolators += falls.length;
            violationDetails.push("Phát hiện NGÃ");
        }

        if (frameViolators > 0) {
            triggerVisualAlarm(frameViolators, violationDetails[0]);
        } else {
            stopVisualAlarm();
        }
    }

    let alarmInterval = null;
    function triggerVisualAlarm(count, detail) {
        const camCard = document.getElementById('primary-cam-card');
        if (!camCard.classList.contains('flash-red')) {
            camCard.classList.add('flash-red');
            
            // Rung điện thoại (Haptic)
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

            // Cập nhật số lượng thông báo
            appState.notifCount += count;
            if (notifBadge) {
                notifBadge.textContent = appState.notifCount;
                notifBadge.classList.add('pulse');
            }

            // Phát âm thanh
            if (detail.includes("NGÃ")) alarmAudio?.play().catch(() => {});
            else ppeAudio?.play().catch(() => {});

            // Log
            insertViolationRow({
                time: new Date().toTimeString().slice(0, 8),
                camera: appState.activeCamera.name,
                type: detail.includes("NGÃ") ? "FALL" : "PPE",
                detail: `${detail} (${count} người)`
            });
        }
    }

    function stopVisualAlarm() {
        const camCard = document.getElementById('primary-cam-card');
        if (camCard) camCard.classList.remove('flash-red');
        if (notifBadge) notifBadge.classList.remove('pulse');
    }

    // ─── Inference Loop (Giữ nguyên cấu trúc, chỉ thay đổi logic check) ───
    async function startInferenceLoop() {
        if (appState.inferenceRunning) return;
        appState.inferenceRunning = true;
        let frameSkip = 0;
        const SKIP_FRAMES = 3;

        async function detectFrame() {
            if (!appState.isCameraActive || !appState.modelLoaded) return;
            frameSkip++;
            if (frameSkip < SKIP_FRAMES) { animFrameId = requestAnimationFrame(detectFrame); return; }
            frameSkip = 0;

            try {
                const rect = videoWebcam.getBoundingClientRect();
                if (overlayCanvas) { overlayCanvas.width = rect.width; overlayCanvas.height = rect.height; }

                inputCtx.drawImage(videoWebcam, 0, 0, 640, 640);
                const tensor = preprocessFrame(inputCtx.getImageData(0, 0, 640, 640));

                const [ppeOut, fallOut] = await Promise.all([
                    sessionPPE.run({ [sessionPPE.inputNames[0]]: tensor }),
                    sessionFall.run({ [sessionFall.inputNames[0]]: tensor })
                ]);

                const ppeResults = postprocess(ppeOut[sessionPPE.outputNames[0]].data, PPE_CLASSES);
                const fallResults = postprocess(fallOut[sessionFall.outputNames[0]].data, FALL_CLASSES);

                drawDetections([...ppeResults, ...fallResults]);
                checkViolations(ppeResults, fallResults);

            } catch (e) { console.error(e); }
            animFrameId = requestAnimationFrame(detectFrame);
        }
        animFrameId = requestAnimationFrame(detectFrame);
    }

    // ─── Các hàm bổ trợ (Preprocess, Postprocess, Draw...) ───────────────
    function preprocessFrame(imageData) {
        const { data, width, height } = imageData;
        const float32 = new Float32Array(3 * 640 * 640);
        for (let i = 0; i < 640 * 640; i++) {
            float32[i] = data[i * 4] / 255.0;
            float32[i + 640 * 640] = data[i * 4 + 1] / 255.0;
            float32[i + 2 * 640 * 640] = data[i * 4 + 2] / 255.0;
        }
        return new ort.Tensor('float32', float32, [1, 3, 640, 640]);
    }

    function postprocess(rawData, classNames) {
        const boxes = [];
        for (let i = 0; i < 8400; i++) {
            let maxConf = 0, maxClass = 0;
            for (let c = 0; c < classNames.length; c++) {
                const conf = rawData[(4 + c) * 8400 + i];
                if (conf > maxConf) { maxConf = conf; maxClass = c; }
            }
            if (maxConf < 0.4) continue;
            const cx = rawData[0 * 8400 + i], cy = rawData[1 * 8400 + i], w = rawData[2 * 8400 + i], h = rawData[3 * 8400 + i];
            boxes.push({ x1: (cx - w / 2) / 640, y1: (cy - h / 2) / 640, x2: (cx + w / 2) / 640, y2: (cy + h / 2) / 640, conf: maxConf, className: classNames[maxClass] });
        }
        return nms(boxes, 0.45);
    }

    function nms(boxes, iouThresh) {
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
                const iou = inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
                if (iou > iouThresh) suppressed.add(j);
            }
        }
        return kept;
    }

    function drawDetections(detections) {
        if (!overlayCtx) return;
        const W = overlayCanvas.width, H = overlayCanvas.height;
        overlayCtx.clearRect(0, 0, W, H);
        detections.forEach(det => {
            const x = det.x1 * W, y = det.y1 * H, w = (det.x2 - det.x1) * W, h = (det.y2 - det.y1) * H;
            overlayCtx.strokeStyle = det.className === 'person' ? '#007aff' : '#34c759';
            if (det.className.includes('fall')) overlayCtx.strokeStyle = '#ff3b30';
            overlayCtx.lineWidth = 2;
            overlayCtx.strokeRect(x, y, w, h);
        });
    }

    function insertViolationRow(log) {
        const tbody = document.getElementById('stats-table-body');
        if (!tbody) return;
        const tr = document.createElement('tr');
        tr.className = 'new-log-flash';
        tr.innerHTML = `<td>${log.time}</td><td>${log.camera}</td><td><span class="${log.type === 'FALL' ? 'badge-fall' : 'badge-danger'}">${log.type}: ${log.detail}</span></td>`;
        tbody.prepend(tr);
        if (tbody.rows.length > 15) tbody.deleteRow(15);
    }

    // ─── Init ─────────────────────────────────────────────────────────────
    async function loadModels() {
        yoloStatusText.textContent = "LOADING...";
        try {
            sessionPPE = await ort.InferenceSession.create('./models/best.onnx', { executionProviders: ['wasm'] });
            sessionFall = await ort.InferenceSession.create('./models/tuthenga.onnx', { executionProviders: ['wasm'] });
            appState.modelLoaded = true;
            yoloStatusText.textContent = "AI READY";
            startCamera();
        } catch (e) { yoloStatusText.textContent = "ERROR"; }
    }

    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } });
            videoWebcam.srcObject = stream;
            await videoWebcam.play();
            appState.isCameraActive = true;
            setupOverlayCanvas();
            startInferenceLoop();
        } catch (e) { alert("Camera Error"); }
    }

    // Nav & Grid
    const navItemsNav = document.querySelectorAll('.nav-item[data-target]');
    navItemsNav.forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${item.getAttribute('data-target')}`).classList.add('active');
        });
    });

    loadModels();
});
