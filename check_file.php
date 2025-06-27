<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: http://localhost:5174');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 86400');

$log_file = __DIR__ . '/logs/check_file.log';
$posts_dir = __DIR__ . '/posts';

// Hàm ghi log
function write_log($message) {
    global $log_file;
    $timestamp = date('Y-m-d H:i:s');
    $log_message = "[$timestamp] $message\n";
    error_log($log_message, 3, $log_file);
}

// Ghi header nhận được
write_log("Yêu cầu: {$_SERVER['REQUEST_METHOD']}, URI: {$_SERVER['REQUEST_URI']}");
write_log("Header nhận được: " . json_encode(getallheaders()));

// Tạo thư mục logs nếu chưa tồn tại
if (!is_dir(dirname($log_file))) {
    if (!mkdir(dirname($log_file), 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Không thể tạo thư mục logs']);
        exit;
    }
    write_log("Tạo thư mục logs thành công");
}

// Xử lý yêu cầu OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    write_log("Xử lý yêu cầu OPTIONS từ {$_SERVER['HTTP_ORIGIN']}");
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'OPTIONS request handled']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $chapter_name = $_GET['chapter_name'] ?? '';
    if (empty($chapter_name)) {
        write_log("Lỗi: Thiếu chapter_name");
        http_response_code(400);
        echo json_encode(['error' => 'Thiếu chapter_name']);
        exit;
    }

    $chapter_name = preg_replace('/[^a-zA-Z0-9_-]/', '_', $chapter_name);
    $json_path = $posts_dir . '/' . $chapter_name . '.json';

    if (file_exists($json_path)) {
        $data = json_decode(file_get_contents($json_path), true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            write_log("Lỗi: Không thể parse JSON từ $json_path, lỗi: " . json_last_error_msg());
            http_response_code(500);
            echo json_encode(['error' => 'Dữ liệu JSON không hợp lệ']);
            exit;
        }
        // Đảm bảo data là mảng
        if (!is_array($data)) {
            write_log("Dữ liệu JSON không phải mảng: " . json_encode($data));
            $data = [$data];
        }
        write_log("Đọc file JSON thành công: $json_path, dữ liệu: " . json_encode($data));
        echo json_encode(['success' => true, 'exists' => true, 'data' => $data]);
    } else {
        write_log("File JSON không tồn tại: $json_path");
        echo json_encode(['success' => true, 'exists' => false, 'data' => []]);
    }
} else {
    write_log("Lỗi: Phương thức không được phép - {$_SERVER['REQUEST_METHOD']}");
    http_response_code(405);
    echo json_encode(['error' => 'Phương thức không được phép']);
}
?>