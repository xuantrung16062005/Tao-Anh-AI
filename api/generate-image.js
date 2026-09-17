// Proxy tạo ảnh Gemini (model "Nano Banana") — giấu API key ở phía server.
// Ưu tiên dùng key riêng client gửi lên (header x-gemini-key, khi người dùng tự nhập ở nút 🔑),
// nếu không có thì dùng biến môi trường GEMINI_API_KEY cấu hình trên Vercel (Project Settings → Environment Variables).
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

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
  const parts = req.body && req.body.parts;
  if (!Array.isArray(parts) || !parts.length) {
    res.status(400).json({ error: { message: 'Thiếu nội dung prompt (parts) để tạo ảnh' } });
    return;
  }
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
      }
    );
    const json = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(json);
  } catch (err) {
    res.status(502).json({ error: { message: 'Không gọi được Gemini: ' + (err && err.message) } });
  }
}
