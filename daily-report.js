const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1522191984020684830/z2Y75Ncd-Ocn0PGWEWrD0_amVNnua5KGdUVxXuHIPSPyIvRv6TmPsDit2ag7gRaHrXID";
const FIREBASE_PROJECT_ID = "device-manage-d4f5d";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/device_logs`;

async function runDailyReport() {
    try {
        console.log("Đang lấy dữ liệu từ Firebase...");
        const response = await fetch(FIRESTORE_URL);
        const data = await response.json();

        let unreturnedList = [];
        let count = 1;

        if (data.documents && data.documents.length > 0) {
            // Sắp xếp các document theo thời gian tạo (Mới nhất ở dưới, hoặc tùy ý)
            data.documents.forEach(doc => {
                const fields = doc.fields;
                if (fields && fields.trangThai && fields.trangThai.stringValue === "Đang Mượn") {
                    const nguoiMuon = fields.nguoiMuon ? fields.nguoiMuon.stringValue : "Chưa rõ";
                    const thietBi = fields.thietBi ? fields.thietBi.stringValue : "Thiết bị lỗi tên";
                    const thoiGian = fields.thoiGian ? fields.thoiGian.stringValue : "";

                    // Tạo chuỗi định dạng y hệt ảnh yêu cầu
                    const itemStr = `${count}. 📲 **${thietBi}**\n👤 **Người mượn:** ${nguoiMuon}\n⏰ **Thời gian mượn:** \`${thoiGian}\`\n`;
                    unreturnedList.push(itemStr);
                    count++;
                }
            });
        }

        if (unreturnedList.length > 0) {
            console.log(`Phát hiện ${unreturnedList.length} thiết bị chưa trả. Đang gửi Discord...`);
            
            // Xử lý ngày giờ hiển thị trên Title (Giờ VN = UTC+7)
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
            const pad = (n) => n.toString().padStart(2, '0');
            const dateString = `${pad(vnTime.getUTCDate())}/${pad(vnTime.getUTCMonth() + 1)}/${vnTime.getUTCFullYear()}`;

            const payload = {
                username: "Daily Device Reporter", // Tên Bot hiển thị
                embeds: [{
                    title: `📋 BÁO CÁO TỔNG HỢP THIẾT BỊ ĐANG MƯỢN (${dateString})`,
                    description: `Tổng số thiết bị chưa trả: **${unreturnedList.length}**\n\n` + unreturnedList.join("\n"),
                    color: 15158332, // Màu viền đỏ/cam
                    footer: { text: "QA Internal Portal - Daily Report at 18:30" },
                    timestamp: now.toISOString()
                }]
            };

            await fetch(DISCORD_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            console.log("Đã gửi thông báo Discord thành công!");
        } else {
            console.log("Tuyệt vời! Không có thiết bị nào đang bị mượn.");
            
            // Tùy chọn: Gửi tin nhắn thông báo khi đã trả hết (Nếu bạn không thích có thể xóa đoạn này)
            const payloadAllClear = {
                username: "Daily Device Reporter",
                embeds: [{
                    title: "🎉 HOÀN TẤT THU HỒI THIẾT BỊ",
                    description: "Tất cả thiết bị mượn trong ngày đã được hoàn trả đầy đủ!",
                    color: 3066993, // Màu viền xanh lá
                    footer: { text: "QA Internal Portal - Daily Report at 18:30" },
                    timestamp: new Date().toISOString()
                }]
            };
            await fetch(DISCORD_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadAllClear)
            });
        }
    } catch (error) {
        console.error("Lỗi khi chạy báo cáo:", error);
    }
}

runDailyReport();
