const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1522191984020684830/z2Y75Ncd-Ocn0PGWEWrD0_amVNnua5KGdUVxXuHIPSPyIvRv6TmPsDit2ag7gRaHrXID";
const FIREBASE_PROJECT_ID = "device-manage-d4f5d";
// Thêm tham số pageSize=1000 để lấy tối đa data mỗi lần gọi
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/device_logs?pageSize=1000`;

async function runDailyReport() {
    try {
        // =========================================================
        // 1. KIỂM TRA NGÀY NGHỈ (CUỐI TUẦN & LỄ TẾT)
        // =========================================================
        // Lấy ngày hiện tại theo giờ VN (UTC+7)
        const now = new Date();
        const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        
        const dayOfWeek = vnTime.getUTCDay(); // 0: Chủ Nhật, 1: Thứ 2, ..., 6: Thứ 7
        const pad = (n) => n.toString().padStart(2, '0');
        const dayMonth = `${pad(vnTime.getUTCDate())}/${pad(vnTime.getUTCMonth() + 1)}`;
        const fullDate = `${dayMonth}/${vnTime.getUTCFullYear()}`;

        // Kiểm tra Thứ 7 (6) hoặc Chủ Nhật (0)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            console.log(`Hôm nay là Cuối tuần (${fullDate}), Bot nghỉ làm!`);
            return; // Dừng toàn bộ hàm, không chạy đoạn lấy dữ liệu bên dưới nữa
        }

        // Danh sách các ngày Lễ Dương Lịch cố định hàng năm (DD/MM)
        const fixedHolidays = [
            "01/01", // Tết Dương Lịch
            "30/04", // Giải phóng miền Nam
            "01/05", // Quốc tế Lao động
            "02/09"  // Quốc khánh
        ];

        // Danh sách các ngày Lễ Âm Lịch hoặc Nghỉ bù (Cập nhật tùy theo năm)
        // Dưới đây là các ngày lễ dự kiến của năm 2026
        const dynamicHolidays = [
            // Nghỉ Tết Nguyên Đán 2026 (VD: Từ 28 tết đến mùng 5 tết)
            "16/02/2026", "17/02/2026", "18/02/2026", "19/02/2026", "20/02/2026", "21/02/2026", "22/02/2026", 
            // Giỗ tổ Hùng Vương 2026 (10/03 Âm lịch) + Nghỉ bù
            "26/04/2026", "27/04/2026",
            // Các ngày nghỉ bù Quốc khánh 2026 (nếu có)
            "01/09/2026", "03/09/2026"
        ];

        // Kiểm tra nếu hôm nay nằm trong danh sách Lễ Tết
        if (fixedHolidays.includes(dayMonth) || dynamicHolidays.includes(fullDate)) {
            console.log(`Hôm nay (${fullDate}) là ngày Lễ/Tết, Bot nghỉ làm!`);
            return; // Dừng toàn bộ hàm
        }

        // =========================================================
        // 2. CHẠY BÁO CÁO NẾU LÀ NGÀY LÀM VIỆC BÌNH THƯỜNG
        // =========================================================
        console.log("Hôm nay là ngày làm việc bình thường. Đang lấy dữ liệu từ Firebase...");
        
        let allDocuments = [];
        let pageToken = "";
        
        // Vòng lặp lấy toàn bộ data (vượt qua giới hạn mặc định của Firebase)
        do {
            let url = FIRESTORE_URL;
            if (pageToken) url += `&pageToken=${pageToken}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.documents) {
                allDocuments.push(...data.documents);
            }
            pageToken = data.nextPageToken; // Chuyển sang trang tiếp theo nếu có
        } while (pageToken);

        let unreturnedList = [];
        let count = 1;

        if (allDocuments.length > 0) {
            allDocuments.forEach(doc => {
                const fields = doc.fields;
                
                // Đồng bộ logic y hệt như trên Web: Lọc những máy KHÔNG chứa chữ "đã trả"
                if (fields && fields.trangThai && !fields.trangThai.stringValue.toLowerCase().includes("đã trả")) {
                    const nguoiMuon = fields.nguoiMuon ? fields.nguoiMuon.stringValue : "Chưa rõ";
                    const thietBi = fields.thietBi ? fields.thietBi.stringValue : "Thiết bị lỗi tên";
                    const thoiGian = fields.thoiGian ? fields.thoiGian.stringValue : "";

                    const itemStr = `${count}. 📲 **${thietBi}**\n👤 **Người mượn:** ${nguoiMuon}\n⏰ **Thời gian mượn:** \`${thoiGian}\`\n`;
                    unreturnedList.push(itemStr);
                    count++;
                }
            });
        }

        const dateString = fullDate; // Tái sử dụng chuỗi ngày tháng đã lấy ở trên

        let payload = {
            username: "Daily Device Reporter", // Tên Bot hiển thị
            embeds: []
        };

        if (unreturnedList.length > 0) {
            console.log(`Phát hiện ${unreturnedList.length} thiết bị chưa trả. Đang gửi Discord...`);
            payload.embeds.push({
                title: `📋 BÁO CÁO TỔNG HỢP THIẾT BỊ ĐANG MƯỢN (${dateString})`,
                description: `Tổng số thiết bị chưa trả: **${unreturnedList.length}**\n\n` + unreturnedList.join("\n"),
                color: 15158332, // Màu viền đỏ/cam
                footer: { text: "QA Internal Portal • Daily Report" },
                timestamp: now.toISOString()
            });
        } else {
            console.log("Tuyệt vời! Không có thiết bị nào đang bị mượn.");
            payload.embeds.push({
                title: `📋 BÁO CÁO TỔNG HỢP THIẾT BỊ ĐANG MƯỢN (${dateString})`,
                description: `Tổng số thiết bị chưa trả: **0**\n\n🎉 **Trạng thái**\nTất cả thiết bị đã được hoàn trả đầy đủ trong ngày!`,
                color: 3066993, // Màu viền xanh lá
                footer: { text: "QA Internal Portal • Daily Report" },
                timestamp: now.toISOString()
            });
        }

        await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        console.log("Đã gửi thông báo Discord thành công!");
        
    } catch (error) {
        console.error("Lỗi khi chạy báo cáo:", error);
    }
}

runDailyReport();
