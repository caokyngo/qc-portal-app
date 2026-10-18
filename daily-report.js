const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const REMINDER_TYPE = process.env.REMINDER_TYPE || 'report';
const FIREBASE_PROJECT_ID = "device-manage-d4f5d";
// Thêm tham số pageSize=1000 để lấy tối đa data mỗi lần gọi
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/device_logs?pageSize=1000`;

async function sendDiscordPayload(payload) {
    if (!DISCORD_WEBHOOK_URL) {
        throw new Error('Thiếu DISCORD_WEBHOOK_URL trong environment của workflow.');
    }

    const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Discord webhook trả về HTTP ${response.status}.`);
    }
}

async function sendDeviceReminder(type, now) {
    const isBorrowReminder = type === 'borrow';
    const title = isBorrowReminder ? '🔔 Nhắc mượn thiết bị' : '🔔 Nhắc trả thiết bị';
    const description = isBorrowReminder
        ? 'Nếu mượn thiết bị, vui lòng bấm **Mượn Device** trên tool để ghi nhận trước khi sử dụng.'
        : 'Vui lòng bấm **Trả Device** trên tool để cập nhật trạng thái thiết bị trước khi ra về.';

    await sendDiscordPayload({
        username: "Daily Device Reporter",
        content: '@everyone',
        allowed_mentions: { parse: ['everyone'] },
        embeds: [{
            title,
            description,
            color: isBorrowReminder ? 3447003 : 15158332,
            footer: { text: "QA Internal Portal • Device Reminder" },
            timestamp: now.toISOString()
        }]
    });
}

function getFieldValue(field) {
    if (!field) return '';
    return field.stringValue ?? field.timestampValue ?? field.integerValue ?? field.doubleValue ?? '';
}

function isBorrowedOnDate(value, year, month, day) {
    if (!value) return false;
    const text = String(value).trim();

    // Firestore timestamps and ISO date strings are compared in Vietnam time.
    const isoDate = new Date(text);
    if (!Number.isNaN(isoDate.getTime())) {
        const vnDate = new Date(isoDate.getTime() + 7 * 60 * 60 * 1000);
        return vnDate.getUTCFullYear() === year &&
            vnDate.getUTCMonth() + 1 === month &&
            vnDate.getUTCDate() === day;
    }

    // The tool commonly stores localized dates such as 18/10/2026 08:30.
    const localized = text.match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\D|$)/);
    if (localized) {
        return Number(localized[1]) === day &&
            Number(localized[2]) === month &&
            Number(localized[3]) === year;
    }

    return false;
}

async function sendDailyBorrowReport(allDocuments, dateString, year, month, day, now) {
    const borrowedToday = allDocuments
        .map(doc => doc.fields || {})
        .filter(fields => isBorrowedOnDate(getFieldValue(fields.thoiGian), year, month, day))
        .map(fields => ({
            device: getFieldValue(fields.thietBi) || 'Thiết bị chưa rõ tên',
            borrower: getFieldValue(fields.nguoiMuon) || 'Chưa rõ',
            borrowedAt: getFieldValue(fields.thoiGian),
            status: getFieldValue(fields.trangThai) || 'Chưa rõ trạng thái'
        }));

    const lines = borrowedToday.length
        ? borrowedToday.map((item, index) =>
            `${index + 1}. 📲 **${item.device}**\n👤 **Người mượn:** ${item.borrower}\n⏰ **Giờ mượn:** \`${item.borrowedAt}\`\n📌 **Trạng thái:** ${item.status}`)
        : ['Hôm nay chưa ghi nhận lượt mượn thiết bị nào.'];

    // Discord limits an embed description to 4096 characters; send multiple messages if needed.
    const chunks = [];
    let chunk = '';
    for (const line of lines) {
        const next = chunk ? `${chunk}\n\n${line}` : line;
        if (next.length > 3800 && chunk) {
            chunks.push(chunk);
            chunk = line;
        } else {
            chunk = next;
        }
    }
    if (chunk) chunks.push(chunk);

    for (let index = 0; index < chunks.length; index++) {
        await sendDiscordPayload({
            username: 'Daily Device Reporter',
            embeds: [{
                title: `📋 REPORT THIẾT BỊ ĐÃ MƯỢN TRONG NGÀY (${dateString})${chunks.length > 1 ? ` • ${index + 1}/${chunks.length}` : ''}`,
                description: `Tổng lượt mượn hôm nay: **${borrowedToday.length}**\n\n${chunks[index]}`,
                color: borrowedToday.length ? 3447003 : 3066993,
                footer: { text: 'QA Internal Portal • Daily Borrow Report' },
                timestamp: now.toISOString()
            }]
        });
    }
    console.log(`Đã gửi report ${borrowedToday.length} lượt mượn trong ngày.`);
}

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

        if (!['report', 'borrow', 'return'].includes(REMINDER_TYPE)) {
        if (!['report', 'borrow', 'return', 'daily-borrow-report'].includes(REMINDER_TYPE)) {
            throw new Error(`REMINDER_TYPE không hợp lệ: ${REMINDER_TYPE}`);
        }

        if (REMINDER_TYPE === 'borrow' || REMINDER_TYPE === 'return') {
            await sendDeviceReminder(REMINDER_TYPE, now);
            console.log(`Đã gửi nhắc ${REMINDER_TYPE === 'borrow' ? 'mượn' : 'trả'} thiết bị.`);
            if (REMINDER_TYPE === 'borrow') return;
            return;
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

        if (REMINDER_TYPE === 'daily-borrow-report') {
            await sendDailyBorrowReport(
                allDocuments,
                fullDate,
                vnTime.getUTCFullYear(),
                vnTime.getUTCMonth() + 1,
                vnTime.getUTCDate(),
                now
            );
            return;
        }

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

        await sendDiscordPayload(payload);
        console.log("Đã gửi thông báo Discord thành công!");
        
    } catch (error) {
        console.error("Lỗi khi chạy báo cáo:", error);
    }
}

runDailyReport();
