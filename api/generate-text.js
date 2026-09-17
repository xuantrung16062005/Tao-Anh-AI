// Proxy Gemini text — dùng để AI tự viết prompt "Mô tả bối cảnh" cho từng phân cảnh.
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Chỉ hỗ trợ POST' } });
    return;
  }
  const apiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(400).json({ error: { message: 'Thiếu Gemini API key: chưa cấu hình biến môi trường GEMINI_API_KEY trên server, và cũng chưa nhập key riêng ở nút 🔑.' } });
    return;
  }
  const text = req.body && req.body.text;
  if (!text || !String(text).trim()) {
    res.status(400).json({ error: { message: 'Thiếu nội dung để AI viết prompt' } });
    return;
  }
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_TEXT_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] })
      }
    );
    const json = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(json);
  } catch (err) {
    res.status(502).json({ error: { message: 'Không gọi được Gemini: ' + (err && err.message) } });
  }
}
