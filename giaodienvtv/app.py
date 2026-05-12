# pyrefly: ignore [missing-import]
import cv2
import math
import time
import asyncio
import os
from collections import defaultdict
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
from ultralytics import YOLO
import uvicorn
import pandas as pd
import sqlite3
import base64
import numpy as np
from datetime import datetime

app = FastAPI(title="Safety Monitor AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- CẤU HÌNH AI -----------------
PPE_MODEL_PATH = '../best.pt'
CONE_MODEL_PATH = '../best (1).pt'
VIDEO_PATH = '../video7.mp4'

PPE_CHECK_TIME = 1
VALID_IGNORE_TIME = 180
ROI_VIOLATION_TIME = 5
CONE_SCAN_INTERVAL = 60
PIXEL_PER_METER = 50
ROI_RADIUS_METER = 2
PERSPECTIVE_RATIO = 0.4

PPE_CONFIDENCE = 0.3
CONE_CONFIDENCE = 0.5
# CONFIDENECE của person
PERSON_CONFIDENCE = 0.3

# Global AI Variables
print("[AI] Khởi tạo hệ thống - Đang nạp Model...")
model_ppe = YOLO(PPE_MODEL_PATH)
model_cone = YOLO(CONE_MODEL_PATH)
print("[AI] Model đã sẵn sàng!")

cone_centers = []
last_cone_scan_time = -CONE_SCAN_INTERVAL

# Global State
TEMP_DIR = "temp_videos"
if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

# SQLite Database Initialization
DB_PATH = "safety_logs.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            track_id INTEGER,
            violation_type TEXT,
            detail TEXT,
            image_path TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

class PersonState:
    def __init__(self):
        self.missing_ppe_start_time = None
        self.is_valid = True
        self.last_full_ppe_time = -999999
        self.last_ppe_warning_time = -999999
        self.roi_intrusion_start_time = None
        self.roi_violation_logged = False

person_states = defaultdict(PersonState)

# Log event storage
system_logs = []
def add_log(track_id, violation_type, detail="", image_base64=None):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # Persist to SQLite
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO logs (timestamp, track_id, violation_type, detail, image_path)
            VALUES (?, ?, ?, ?, ?)
        ''', (timestamp, track_id, violation_type, detail, "snapshot_embedded"))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB Error] {e}")

    # Memory logs for real-time display (last 50)
    system_logs.insert(0, {
        "time": timestamp.split(' ')[1],
        "id": track_id,
        "type": violation_type,
        "detail": detail,
        "image": image_base64
    })
    if len(system_logs) > 50:
        system_logs.pop()

def is_center_inside(inner_box, outer_box):
    ix1, iy1, ix2, iy2 = inner_box
    ox1, oy1, ox2, oy2 = outer_box
    cx = (ix1 + ix2) / 2
    cy = (iy1 + iy2) / 2
    return (ox1 <= cx <= ox2) and (oy1 <= cy <= oy2)

async def generate_frames(cam_id: str):
    global model_ppe, model_cone, person_states, cone_centers, last_cone_scan_time
    
    # RESET TOÀN BỘ TRẠNG THÁI KHI BẮT ĐẦU NGUỒN MỚI
    cone_centers = [] 
    last_cone_scan_time = -CONE_SCAN_INTERVAL
    person_states.clear()
    
    # Mapping nguồn dữ liệu
    if cam_id == "1":
        source = VIDEO_PATH
    elif cam_id == "2":
        source = 0  # Webcam
    else:
        # Kiểm tra file upload
        full_path = os.path.join(TEMP_DIR, cam_id)
        source = full_path if os.path.exists(full_path) else VIDEO_PATH

    cap = cv2.VideoCapture(source)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0 or math.isnan(fps): fps = 30.0
    interval = 1.0 / fps

    frame_count = 0

    while True:
        t0 = time.time()
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
            
        frame_count += 1
        current_time = frame_count / fps 

        # 1. QUÉT CONE/SIGN MỖI 60s (ROI BỀN VỮNG)
        if current_time - last_cone_scan_time >= CONE_SCAN_INTERVAL:
            results_cone = model_cone(frame, conf=CONE_CONFIDENCE, verbose=False)
            new_centers = []
            if results_cone[0].boxes is not None:
                for box in results_cone[0].boxes:
                    cls_name = model_cone.names[int(box.cls[0].item())].lower()
                    if 'cone' in cls_name or 'sign' in cls_name:
                        cx = (box.xyxy[0][0].item() + box.xyxy[0][2].item()) / 2
                        cy = box.xyxy[0][3].item()
                        new_centers.append([int(cx), int(cy)])
            
            # CHỈ CẬP NHẬT NẾU TÌM THẤY VẬT CẢN (TRÁNH BỊ CHE KHUẤT TẠM THỜI)
            if len(new_centers) > 0:
                cone_centers = new_centers
                
            last_cone_scan_time = current_time

        # Vẽ ROI Đa giác (Polygon) hoặc Vòng tròn (nếu ít cọc)
        roi_violation_active = any(state.roi_violation_logged for state in person_states.values())
        color = (0, 0, 255) if (roi_violation_active and int(time.time() * 5) % 2 == 0) else (0, 255, 255)

        if len(cone_centers) >= 3:
            overlay = frame.copy()
            pts = np.array(cone_centers, np.int32)
            pts = pts.reshape((-1, 1, 2))
            
            # Đổ màu đa giác
            cv2.fillPoly(overlay, [pts], color)
            cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)
            # Vẽ đường viền đa giác
            cv2.polylines(frame, [pts], True, color, 3)
            
            # Nhãn VÙNG NGUY HIỂM tại cọc đầu tiên
            cv2.putText(frame, "[VUNG NGUY HIEM]", (cone_centers[0][0], cone_centers[0][1] - 15), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        elif len(cone_centers) > 0:
            # Nếu ít hơn 3 cọc, vẽ vòng tròn quanh mỗi cọc để người dùng vẫn thấy ROI
            roi_radius_pixel = int(ROI_RADIUS_METER * PIXEL_PER_METER)
            for cx, cy in cone_centers:
                cv2.circle(frame, (cx, cy), roi_radius_pixel, color, 2)
                cv2.circle(frame, (cx, cy), 5, color, -1) # Chấm tâm cọc
            cv2.putText(frame, "[ROI - CAN THEM COC]", (cone_centers[0][0], cone_centers[0][1] - 15), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        # 2. TRACKING PPE
        # Lấy ngưỡng thấp nhất để YOLO không bỏ sót bất kỳ box nào
        min_conf = min(PPE_CONFIDENCE, PERSON_CONFIDENCE)
        results_ppe = model_ppe.track(frame, conf=min_conf, persist=True, tracker="botsort.yaml", verbose=False)
        
        persons, helmets, vests = [], [], []
        if results_ppe[0].boxes is not None:
            for box in results_ppe[0].boxes:
                cls_name = model_ppe.names[int(box.cls[0].item())].lower()
                conf_val = float(box.conf[0].item())
                
                if 'person' in cls_name:
                    # Lọc riêng ngưỡng cho Person
                    if conf_val >= PERSON_CONFIDENCE:
                        track_id = int(box.id[0].item()) if box.id is not None else None
                        persons.append((box, track_id))
                elif 'helmet' in cls_name or 'hat' in cls_name:
                    # Lọc ngưỡng cho Helmet
                    if conf_val >= PPE_CONFIDENCE:
                        helmets.append(box)
                elif 'vest' in cls_name or 'jacket' in cls_name:
                    # Lọc ngưỡng cho PPE
                    if conf_val >= PPE_CONFIDENCE:
                        vests.append(box)

        # Xử lý logic
        for p_box, track_id in persons:
            if track_id is None: continue
            state = person_states[track_id]
            px1, py1, px2, py2 = p_box.xyxy[0].tolist()
            p_feet_x, p_feet_y = (px1 + px2) / 2, py2
            
            has_helmet = any(is_center_inside(h.xyxy[0].tolist(), [px1, py1, px2, py2]) for h in helmets)
            has_vest = any(is_center_inside(v.xyxy[0].tolist(), [px1, py1, px2, py2]) for v in vests)

            if has_helmet and has_vest:
                state.last_full_ppe_time = current_time

            if current_time - state.last_full_ppe_time < VALID_IGNORE_TIME:
                has_helmet, has_vest = True, True

            missing_items = []
            if not has_helmet: missing_items.append("Helmet")
            if not has_vest: missing_items.append("Vest")
            missing_text = "No " + " & ".join(missing_items) if missing_items else ""

            if has_helmet and has_vest:
                state.missing_ppe_start_time = None
                state.is_valid = True
            else:
                if state.missing_ppe_start_time is None:
                    state.missing_ppe_start_time = current_time
                if current_time - state.missing_ppe_start_time >= PPE_CHECK_TIME:
                    state.is_valid = False
                    if current_time - state.last_ppe_warning_time >= 10:
                        add_log(track_id, "PPE", missing_text)
                        state.last_ppe_warning_time = current_time

            # Xâm nhập ROI Đa giác
            in_roi = False
            if len(cone_centers) >= 3:
                pts = np.array(cone_centers, np.int32)
                in_roi = cv2.pointPolygonTest(pts, (int(p_feet_x), int(p_feet_y)), False) >= 0
            
            # Crop Image for violation log (base64)
            violation_snapshot = None
            if not state.is_valid or (in_roi and state.roi_intrusion_start_time):
                try:
                    h_img, w_img = frame.shape[:2]
                    x1_c, y1_c = max(0, int(px1)-20), max(0, int(py1)-20)
                    x2_c, y2_c = min(w_img, int(px2)+20), min(h_img, int(py2)+20)
                    crop = frame[y1_c:y2_c, x1_c:x2_c]
                    if crop.size > 0:
                        _, buffer = cv2.imencode('.jpg', crop, [cv2.IMWRITE_JPEG_QUALITY, 50])
                        violation_snapshot = base64.b64encode(buffer).decode('utf-8')
                except: pass

            if not state.is_valid and in_roi:
                if state.roi_intrusion_start_time is None:
                    state.roi_intrusion_start_time = current_time
                elif current_time - state.roi_intrusion_start_time >= ROI_VIOLATION_TIME:
                    if not state.roi_violation_logged:
                        add_log(track_id, "ROI", "Xâm nhập vùng cấm", violation_snapshot)
                        state.roi_violation_logged = True
            else:
                state.roi_intrusion_start_time = None
                state.roi_violation_logged = False

            if not state.is_valid and current_time - state.last_ppe_warning_time >= 10:
                 add_log(track_id, "PPE", missing_text, violation_snapshot)
                 state.last_ppe_warning_time = current_time

            # Vẽ bounding box nâng cấp
            color = (0, 255, 0) if state.is_valid else (0, 0, 255)
            if state.is_valid:
                label = f"ID:{track_id} | AN TOAN"
                cv2.rectangle(frame, (int(px1), int(py1)), (int(px2), int(py2)), color, 2)
                cv2.putText(frame, label, (int(px1), int(py1) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
            else:
                label = f"!! {missing_text.upper()} !!"
                cv2.rectangle(frame, (int(px1), int(py1)), (int(px2), int(py2)), (0, 0, 255), 3)
                # Chữ to rõ cho lỗi
                cv2.putText(frame, label, (int(px1), int(py1) - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                cv2.putText(frame, f"id:{track_id}", (int(px1), int(py1) - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)

            if state.roi_violation_logged:
                cv2.putText(frame, "!!! INTRUSION !!!", (int(px1), int(py1) - 65), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 3)

        # Encode and stream
        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ret:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                   
        # Await frame time
        elapsed = time.time() - t0
        await asyncio.sleep(max(0.001, interval - elapsed))

@app.get("/video_feed/{cam_id}")
async def video_feed(cam_id: str):
    # cam_id có thể là "1", "2" hoặc tên file
    return StreamingResponse(generate_frames(cam_id), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/upload_video")
async def upload_video(file: UploadFile = File(...)):
    try:
        file_path = os.path.join(TEMP_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"filename": file.filename, "status": "success"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.get("/api/logs/history")
async def get_log_history(limit: int = 100):
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.get("/api/cameras")
async def get_cameras():
    return [
        {"id": 1, "name": "Khu vực A - Cổng 1", "status": "online"},
        {"id": 2, "name": "Khu vực B - Lối thoát", "status": "stopped"},
        {"id": 3, "name": "Bãi xe Tầng 1", "status": "stopped"}
    ]

@app.get("/api/stats")
async def get_stats():
    ppe_count = len([l for l in system_logs if l['type'] == 'PPE'])
    roi_count = len([l for l in system_logs if l['type'] == 'ROI'])
    return {
        "empty_spots": 128,
        "occupancy_rate": 85,
        "cameras": {"online": 1, "total": 3, "error": 0},
        "yolo_ready": True,
        "ppe_violations": ppe_count,
        "roi_violations": roi_count,
        "lots": [
            {"id": 1, "name": "Khu A - Tầng 1", "total_spots": 50, "empty_spots": 12},
            {"id": 2, "name": "Khu B - Tầng 1", "total_spots": 40, "empty_spots": 5},
            {"id": 3, "name": "Khu C - Tầng 2", "total_spots": 60, "empty_spots": 45}
        ]
    }

@app.get("/api/logs")
async def get_logs():
    return {"logs": system_logs}

# Phục vụ các file tĩnh (html, css, js)
current_dir = os.path.dirname(os.path.abspath(__file__))
app.mount("/", StaticFiles(directory=current_dir, html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=5001, reload=False, log_level="warning")
