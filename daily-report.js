const PROJECT_ID = 'device-manage-d4f5d';
const FIRESTORE_QUERY_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;

const CRON_TYPES = {
  '30 2 * * mon-fri': 'borrow',
  '0 11 * * mon-fri': 'return',
  '0 12 * * mon-fri': 'report',
};

const FIXED_HOLIDAYS = ['01/01', '30/04', '01/05', '02/09'];
const HOLIDAYS_2026 = [
  '16/02/2026', '17/02/2026', '18/02/2026', '19/02/2026',
  '20/02/2026', '21/02/2026', '22/02/2026',
  '26/04/2026', '27/04/2026',
  '01/09/2026', '03/09/2026',
];

export default {
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledTask(controller, env));
  },
};

async function runScheduledTask(controller, env) {
  const type = CRON_TYPES[controller.cron];
  if (!type) throw new Error(`Cron chưa được cấu hình: ${controller.cron}`);

  const now = new Date(controller.scheduledTime);
  const { dayOfWeek, dayMonth, fullDate } = getVietnamDateParts(now);

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`Bỏ qua cuối tuần: ${fullDate}`);
    return;
  }

  if (FIXED_HOLIDAYS.includes(dayMonth) || HOLIDAYS_2026.includes(fullDate)) {
    console.log(`Bỏ qua ngày lễ: ${fullDate}`);
    return;
  }

  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error('Chưa cấu hình Secret DISCORD_WEBHOOK_URL trên Cloudflare.');
  }

  if (type === 'borrow' || type === 'return') {
    await sendDeviceReminder(type, now, env.DISCORD_WEBHOOK_URL);
    console.log(`Đã gửi nhắc ${type === 'borrow' ? 'mượn' : 'trả'} thiết bị.`);
    return;
  }

  const documents = await fetchDocumentsCreatedWithinLastMonth(now);
  await sendRecentUnreturnedReport(documents, fullDate, now, env.DISCORD_WEBHOOK_URL);
}

function getVietnamDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return {
    dayOfWeek: weekdayIndex,
    dayMonth: `${values.day}/${values.month}`,
    fullDate: `${values.day}/${values.month}/${values.year}`,
  };
}

async function sendDeviceReminder(type, now, webhookUrl) {
  const isBorrow = type === 'borrow';
  const title = isBorrow ? '📣 NHẮC MƯỢN THIẾT BỊ' : '📣 NHẮC TRẢ THIẾT BỊ';
  const description = isBorrow
    ? '👋 Cả nhà ơi!\n\n📲 Nhớ bấm **Mượn Device** để ghi nhận trước khi sử dụng nhé cả nhà!\n\n✅ Ghi nhận trên tool giúp mọi người theo dõi thiết bị chính xác.'
    : '👋 Cả nhà ơi!\n\n↩️ Nhớ bấm **Trả Device** trên tool để cập nhật trạng thái thiết bị trước khi ra về nhé!\n\n✅ Cảm ơn cả nhà đã cập nhật tình trạng thiết bị.';

  await sendDiscordPayload(webhookUrl, {
    username: 'Daily Device Reporter',
    content: '@everyone',
    allowed_mentions: { parse: ['everyone'] },
    embeds: [{
      title,
      description,
      color: isBorrow ? 3447003 : 15158332,
      footer: {
        text: `QA Internal Portal • ${isBorrow ? 'Nhắc mượn thiết bị' : 'Nhắc trả thiết bị'} • ${formatVietnamTime(now)}`,
      },
      timestamp: now.toISOString(),
    }],
  });
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
                  value: { timestampValue: oneMonthAgo.toISOString() },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'createdAt' },
                  op: 'LESS_THAN',
                  value: { timestampValue: now.toISOString() },
                },
              },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore query lỗi HTTP ${response.status}: ${body || response.statusText}`);
  }

  const rows = await response.json();
  return rows.map((row) => row.document).filter(Boolean);
}

async function sendRecentUnreturnedReport(documents, dateString, now, webhookUrl) {
  const unreturned = documents
    .map(({ fields = {} }) => fields)
    .filter((fields) => !String(getFieldValue(fields.trangThai)).toLowerCase().includes('đã trả'))
    .map((fields) => ({
      device: getFieldValue(fields.thietBi) || 'Thiết bị chưa rõ tên',
      borrower: getFieldValue(fields.nguoiMuon) || 'Chưa rõ',
      borrowedAt: getFieldValue(fields.thoiGian) || 'Chưa rõ',
      status: getFieldValue(fields.trangThai) || 'Chưa rõ trạng thái',
    }));

  const entries = unreturned.length
    ? unreturned.map((item, index) =>
      `${index + 1}. 📲 **${item.device}**\n👤 **Người mượn:** ${item.borrower}\n⏰ **Giờ mượn:** \`${item.borrowedAt}\`\n📌 **Trạng thái:** ${item.status}`)
    : ['Không có thiết bị nào đang mượn trong phạm vi log được kiểm tra.'];

  const chunks = splitDiscordDescription(entries, 3600);
  for (let index = 0; index < chunks.length; index += 1) {
    await sendDiscordPayload(webhookUrl, {
      username: 'Daily Device Reporter',
      embeds: [{
        title: `📋 BÁO CÁO TỔNG HỢP THIẾT BỊ ĐANG MƯỢN (${dateString})${chunks.length > 1 ? ` • ${index + 1}/${chunks.length}` : ''}`,
        description: `Đối chiếu các lượt mượn trong 30 ngày gần nhất.\nTổng thiết bị chưa trả: **${unreturned.length}**\n\n${chunks[index]}`,
        color: unreturned.length ? 3447003 : 3066993,
        footer: { text: 'QA Internal Portal • Báo cáo thiết bị chưa trả' },
        timestamp: now.toISOString(),
      }],
    });
  }

  console.log(`Đã gửi report ${unreturned.length} thiết bị chưa trả từ log 30 ngày gần nhất.`);
}

function splitDiscordDescription(lines, maxLength) {
  const chunks = [];
  let chunk = '';
  for (const line of lines) {
    const next = chunk ? `${chunk}\n\n${line}` : line;
    if (next.length > maxLength && chunk) {
      chunks.push(chunk);
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function getFieldValue(field) {
  if (!field) return '';
  return field.stringValue ?? field.timestampValue ?? field.integerValue ?? field.doubleValue ?? '';
}

function formatVietnamTime(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function sendDiscordPayload(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook lỗi HTTP ${response.status}: ${body || response.statusText}`);
  }
}
