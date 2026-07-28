const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1522191984020684830/z2Y75Ncd-Ocn0PGWEWrD0_amVNnua5KGdUVxXuHIPSPyIvRv6TmPsDit2ag7gRaHrXID";
const FIREBASE_PROJECT_ID = "device-manage-d4f5d";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/device_logs`;

async function runDailyReport() {
    try {
        console.log("Đang lấy dữ liệu từ Firebase...");
        const response = await fetch(FIRESTORE_URL);
        const data = await response.json();

        let unreturnedList = [];

        if (data.documents && data.documents.length > 0) {
            data.documents.forEach(doc => {
                const fields = doc.fields;
                if (fields && fields.trangThai && fields.trangThai.stringValue === "Đang Mượn") {
                    const nguoiMuon = fields.nguoiMuon ? fields.nguoiMuon.stringValue : "Chưa rõ";
                    const thietBi = fields.thietBi ? fields.thietBi.stringValue : "Thiết bị lỗi tên";
                    const thoiGian = fields.thoiGian ? fields.thoiGian.stringValue : "";

                    unreturnedList.push(`🔸 **${thietBi}** (Đang giữ bởi: \`${nguoiMuon}\` từ ${thoiGian})`);
                }
            });
        }

        if (unreturnedList.length > 0) {
            console.log(`Phát hiện ${unreturnedList.length} thiết bị chưa trả. Đang gửi Discord...`);
            const payload = {
                embeds: [{
                    title: "⚠️ BÁO CÁO CUỐI NGÀY: THIẾT BỊ CHƯA TRẢ",
                    description: "Dưới đây là danh sách các máy đang được mượn tính đến 18h30 hôm nay:\n\n" + unreturnedList.join("\n"),
                    color: 15158332, // Đỏ cam
                    footer: { text: "Nhắc nhở tự động từ QC Portal (GitHub Actions)" },
                    timestamp: new Date().toISOString()
                }]
            };

            await fetch(DISCORD_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            console.log("Đã gửi thông báo Discord thành công!");
        } else {
            console.log("Tuyệt vời! Không có thiết bị nào đang bị mượn (hoặc chưa trả).");
        }
    } catch (error) {
        console.error("Lỗi khi chạy báo cáo:", error);
    }
}

runDailyReport();