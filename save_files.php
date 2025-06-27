<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: http://localhost:5174');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 86400');

$log_file = __DIR__ . '/logs/save_files.log';
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

// Kiểm tra quyền ghi file log
if (!is_writable(dirname($log_file))) {
    http_response_code(500);
    echo json_encode(['error' => 'Không có quyền ghi vào thư mục logs']);
    exit;
}

// Tạo thư mục posts và audio nếu chưa tồn tại
if (!is_dir($posts_dir)) {
    if (!mkdir($posts_dir, 0755, true)) {
        write_log("Lỗi: Không thể tạo thư mục $posts_dir");
        http_response_code(500);
        echo json_encode(['error' => 'Không thể tạo thư mục posts']);
        exit;
    }
    write_log("Tạo thư mục $posts_dir thành công");
}
if (!is_dir($audio_dir)) {
    if (!mkdir($audio_dir, 0755, true)) {
        write_log("Lỗi: Không thể tạo thư mục $audio_dir");
        http_response_code(500);
        echo json_encode(['error' => 'Không thể tạo thư mục audio']);
        exit;
    }
    write_log("Tạo thư mục $audio_dir thành công");
}

// Tạo file chapters.json nếu chưa tồn tại
if (!file_exists($chapters_file)) {
    file_put_contents($chapters_file, json_encode([]));
    write_log("Tạo file chapters.json thành công");
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    write_log("Xử lý yêu cầu OPTIONS từ {$_SERVER['HTTP_ORIGIN']}");
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'OPTIONS request handled']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    write_log("Dữ liệu đầu vào: " . json_encode($input));

    $chapter_name = $input['chapter_name'] ?? '';
    $json_data = $input['json_data'] ?? [];
    $audio_data = $input['audio_data'] ?? '';
    $audio_filename = $input['audio_filename'] ?? '';

    // Kiểm tra dữ liệu đầu vào
    if (empty($chapter_name)) {
        write_log("Lỗi: Thiếu chapter_name");
        http_response_code(400);
        echo json_encode(['error' => 'Thiếu chapter_name']);
        exit;
    }

    // Đảm bảo json_data là mảng
    if (!is_array($json_data)) {
        $json_data = [$json_data];
    }

    // Lấy chapterName từ json_data nếu có
    $chapter_title = !empty($json_data) && isset($json_data[0]['chapterName']) ? $json_data[0]['chapterName'] : $chapter_name;

    // Kiểm tra chapter_name hợp lệ
    $chapter_name = preg_replace('/[^a-zA-Z0-9_-]/', '_', $chapter_name);
    if (empty($chapter_name)) {
        write_log("Lỗi: chapter_name không hợp lệ sau khi làm sạch");
        http_response_code(400);
        echo json_encode(['error' => 'chapter_name không hợp lệ']);
        exit;
    }

    // Lưu file JSON
    $json_path = $posts_dir . '/' . $chapter_name . '.json';
    if (!empty($json_data)) {
        write_log("Chuẩn bị lưu file JSON: $json_path");
        if (!file_put_contents($json_path, json_encode($json_data, JSON_PRETTY_PRINT))) {
            write_log("Lỗi: Không thể lưu file JSON vào $json_path");
            http_response_code(500);
            echo json_encode(['error' => 'Không thể lưu file JSON']);
            exit;
        }
        write_log("Lưu file JSON thành công: $json_path");

        // Cập nhật chapters.json
        $chapters = json_decode(file_get_contents($chapters_file), true);
        if (!is_array($chapters)) {
            $chapters = [];
        }
        $chapters = array_filter($chapters, fn($ch) => $ch['slug'] !== $chapter_name);
        $chapters[] = ['slug' => $chapter_name, 'name' => $chapter_title];
        file_put_contents($chapters_file, json_encode($chapters, JSON_PRETTY_PRINT));
        write_log("Cập nhật chapters.json thành công");
    }

    // Lưu file WAV nếu có
    $audio_path = null;
    if ($audio_data && $audio_filename) {
        $audio_path = $audio_dir . '/' . $audio_filename;
        write_log("Chuẩn bị lưu file WAV: $audio_path");
        $decoded_audio = base64_decode($audio_data, true);
        if ($decoded_audio === false) {
            write_log("Lỗi: Không thể giải mã base64 cho audio_data");
            http_response_code(400);
            echo json_encode(['error' => 'Dữ liệu audio không hợp lệ']);
            exit;
        }
        if (!file_put_contents($audio_path, $decoded_audio)) {
            write_log("Lỗi: Không thể lưu file WAV vào $audio_path");
            http_response_code(500);
            echo json_encode(['error' => 'Không thể lưu file WAV']);
            exit;
        }
        write_log("Lưu file WAV thành công: $audio_path");
    }

    write_log("Xử lý yêu cầu POST thành công");
    echo json_encode([
        'success' => true,
        'json_path' => $json_path,
        'audio_path' => $audio_path ? "/audio/$audio_filename" : null
    ]);
} else {
    write_log("Lỗi: Phương thức không được phép - {$_SERVER['REQUEST_METHOD']}");
    http_response_code(405);
    echo json_encode(['error' => 'Phương thức không được phép']);
}
?>