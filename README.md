# chainies

Bảng học tiếng Trung hướng tới giao tiếp và thi HSK4.

- **Tổng quan**: việc hôm nay, tiến độ từng cấp HSK, lịch học, chuỗi ngày, đếm ngược ngày thi.
- **Thẻ từ**: 3.181 từ HSK 1–4 theo chuẩn mới (HSK 3.0) có pinyin và nghĩa tiếng Việt, ôn theo lặp lại ngắt quãng.
- **Luyện viết**: xem thứ tự nét rồi tự viết từng chữ, có chấm từng nét (đủ các chữ của HSK 1).
- **Kiểm tra**: 10 câu trắc nghiệm, từ sai quay lại hàng ôn.
- **Giao tiếp**: 8 chủ đề hội thoại, chạm để nghe từng câu.
- **Tiến độ**: từ đã thuộc, cần ôn, đang học, chưa học; tra theo chữ Hán, pinyin hoặc nghĩa.
- **Tuỳ chỉnh**: tên, ngày thi, số từ mỗi ngày, màu chủ đạo, nền sáng/tối, kiểu chữ Hán.

Không cần cài đặt: mở `index.html` trong trình duyệt. Từ vựng và hội thoại nằm trong `data.js`, mỗi từ một dòng `chữ Hán|pinyin|nghĩa`.

Mặc định bắt đầu từ HSK 1; bật thêm cấp độ ở trang Thẻ từ. `build.sh` gộp tất cả thành một tệp HTML.

Thứ tự nét dùng thư viện [Hanzi Writer](https://hanziwriter.org) (MIT); dữ liệu nét trong `strokes.js` lấy từ hanzi-writer-data / Make Me a Hanzi (Arphic Public License).

Danh sách từ và cấp độ theo chuẩn mới lấy từ [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT); nghĩa tiếng Việt tự soạn.
