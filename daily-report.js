const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const REMINDER_TYPE = process.env.REMINDER_TYPE || 'report';
const IS_MANUAL_RUN = process.env.IS_MANUAL_RUN === 'true';
const FIREBASE_PROJECT_ID = "device-manage-d4f5d";
const FIRESTORE_QUERY_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

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
        const responseBody = await response.text();
        throw new Error(`Discord webhook trả về HTTP ${response.status}: ${responseBody || response.statusText}`);
    }
}

async function sendDeviceReminder(type, now) {
    const isBorrowReminder = type === 'borrow';
    const title = isBorrowReminder ? '📣 NHẮC MƯỢN THIẾT BỊ' : '📣 NHẮC TRẢ THIẾT BỊ';
    const description = isBorrowReminder
        ? '👋 Cả nhà ơi!\n\n📲 Nhớ bấm **Mượn Device** để ghi nhận trước khi sử dụng nhé cả nhà!\n\n✅ Ghi nhận trên tool giúp mọi người theo dõi thiết bị chính xác.'
        : '👋 Cả nhà ơi!\n\n↩️ Nhớ bấm **Trả Device** trên tool để cập nhật trạng thái thiết bị trước khi ra về nhé!\n\n✅ Cảm ơn cả nhà đã cập nhật tình trạng thiết bị.';

    await sendDiscordPayload({
        username: "Daily Device Reporter",
        content: IS_MANUAL_RUN ? '' : '@everyone',
        allowed_mentions: { parse: IS_MANUAL_RUN ? [] : ['everyone'] },
        embeds: [{
            title,
            description,
            color: isBorrowReminder ? 3447003 : 15158332,
            footer: { text: `QA Internal Portal • ${isBorrowReminder ? 'Nhắc mượn thiết bị' : 'Nhắc trả thiết bị'} • ${now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}` },
            timestamp: now.toISOString()
        }]
    });
}

function getFieldValue(field) {
    if (!field) return '';
    return field.stringValue ?? field.timestampValue ?? field.integerValue ?? field.doubleValue ?? '';
}

async function sendRecentUnreturnedReport(allDocuments, dateString, now) {
    const unreturnedDevices = allDocuments
        .map(doc => doc.fields || {})
        .filter(fields => !String(getFieldValue(fields.trangThai)).toLowerCase().includes('đã trả'))
        .map(fields => ({
            device: getFieldValue(fields.thietBi) || 'Thiết bị chưa rõ tên',
            borrower: getFieldValue(fields.nguoiMuon) || 'Chưa rõ',
            borrowedAt: getFieldValue(fields.thoiGian),
            status: getFieldValue(fields.trangThai) || 'Chưa rõ trạng thái'
        }));

    const lines = unreturnedDevices.length
        ? unreturnedDevices.map((item, index) =>
            `${index + 1}. 📲 **${item.device}**\n👤 **Người mượn:** ${item.borrower}\n⏰ **Giờ mượn:** \`${item.borrowedAt}\`\n📌 **Trạng thái:** ${item.status}`)
        : ['Không có thiết bị nào đang mượn trong phạm vi log được kiểm tra.'];

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
                title: `📋 BÁO CÁO TỔNG HỢP THIẾT BỊ ĐANG MƯỢN (${dateString})${chunks.length > 1 ? ` • ${index + 1}/${chunks.length}` : ''}`,
                description: `Đối chiếu các lượt mượn trong 30 ngày gần nhất.\nTổng thiết bị chưa trả: **${unreturnedDevices.length}**\n\n${chunks[index]}`,
                color: unreturnedDevices.length ? 3447003 : 3066993,
                footer: { text: 'QA Internal Portal • Báo cáo thiết bị chưa trả' },
                timestamp: now.toISOString()
            }]
        });
    }
    console.log(`Đã gửi report ${unreturnedDevices.length} thiết bị chưa trả trong phạm vi 30 ngày.`);
}

async function fetchDocumentsCreatedWithinLastMonth(now) {
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const response = await fetch(FIRESTORE_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: 'device_logs' }],
                where: {
                    compositeFilter: {
                        op: 'AND',
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'createdAt' },
                                    op: 'GREATER_THAN_OR_EQUAL',
                                    value: { timestampValue: oneMonthAgo.toISOString() }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'createdAt' },
                                    op: 'LESS_THAN',
                                    value: { timestampValue: now.toISOString() }
                                }
                            }
                        ]
                    }
                },
                orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }]
            }
        })
    });

    if (!response.ok) {
        const responseBody = await response.text();
        throw new Error(`Firestore query trả về HTTP ${response.status}: ${responseBody || response.statusText}`);
    }

    const rows = await response.json();
    return rows.map(row => row.document).filter(Boolean);
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
        if (!IS_MANUAL_RUN && (dayOfWeek === 0 || dayOfWeek === 6)) {
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
        if (!IS_MANUAL_RUN && (fixedHolidays.includes(dayMonth) || dynamicHolidays.includes(fullDate))) {
            console.log(`Hôm nay (${fullDate}) là ngày Lễ/Tết, Bot nghỉ làm!`);
            return; // Dừng toàn bộ hàm
        }

        if (!['report', 'borrow', 'return', 'daily-borrow-report'].includes(REMINDER_TYPE)) {
            throw new Error(`REMINDER_TYPE không hợp lệ: ${REMINDER_TYPE}`);
        }

        if (REMINDER_TYPE === 'borrow' || REMINDER_TYPE === 'return') {
            await sendDeviceReminder(REMINDER_TYPE, now);
            console.log(`Đã gửi nhắc ${REMINDER_TYPE === 'borrow' ? 'mượn' : 'trả'} thiết bị.`);
            return;
        }

        // =========================================================
        // 2. CHẠY BÁO CÁO NẾU LÀ NGÀY LÀM VIỆC BÌNH THƯỜNG
        // =========================================================
        console.log("Hôm nay là ngày làm việc bình thường. Đang lấy dữ liệu từ Firebase...");
        
        let allDocuments = [];
        if (REMINDER_TYPE === 'report' || REMINDER_TYPE === 'daily-borrow-report') {
            // Cả chạy thủ công và lịch 19:00 chỉ đọc log 30 ngày gần nhất,
            // rồi lọc các thiết bị hiện vẫn chưa được trả.
            allDocuments = await fetchDocumentsCreatedWithinLastMonth(now);
            await sendRecentUnreturnedReport(allDocuments, fullDate, now);
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
        process.exitCode = 1;
    }
}

runDailyReport();
