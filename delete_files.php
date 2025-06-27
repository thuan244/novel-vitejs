<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: http://localhost:5174');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 86400');

$log_file = __DIR__ . '/logs/delete_files.log';
$posts_dir = __DIR__ . '/posts';
$audio_dir = __DIR__ . '/audio';
$chapters_file = __DIR__ . '/chapters.json';

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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    write_log("Xử lý yêu cầu OPTIONS từ {$_SERVER['HTTP_ORIGIN']}");
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'OPTIONS request handled']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Xóa file trong posts
    if (is_dir($posts_dir)) {
        $files = glob($posts_dir . '/*.json');
        foreach ($files as $file) {
            if (is_file($file)) {
                unlink($file);
                write_log("Xóa file: $file");
            }
        }
    }

    // Xóa file trong audio
    if (is_dir($audio_dir)) {
        $files = glob($audio_dir . '/*.wav');
        foreach ($files as $file) {
            if (is_file($file)) {
                unlink($file);
                write_log("Xóa file: $file");
            }
        }
    }

    // Xóa chapters.json
    if (file_exists($chapters_file)) {
        unlink($chapters_file);
        write_log("Xóa file: $chapters_file");
    }

    write_log("Xóa dữ liệu thành công");
    echo json_encode(['success' => true]);
} else {
    write_log("Lỗi: Phương thức không được phép - {$_SERVER['REQUEST_METHOD']}");
    http_response_code(405);
    echo json_encode(['error' => 'Phương thức không được phép']);
}
?>