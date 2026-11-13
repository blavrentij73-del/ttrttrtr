// Простейший бэкенд для оплаты Telegram Stars в игре «Мой город».
//
// Запуск:  node payment-backend-example.js
// Требуется Node.js 18+ (встроенный fetch), внешние пакеты не нужны.
// Переменные окружения:
//   BOT_TOKEN  — токен бота от @BotFather (обязательно)
//   PORT       — порт (по умолчанию 8080)
//
// Подключение в игре:
//   1. Разместите этот сервер на HTTPS-домене.
//   2. В city-builder-tg.html укажите: const PAY_BACKEND = 'https://ваш-домен';
//   3. Зарегистрируйте вебхук у Telegram:
//      https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://ваш-домен/webhook/<секрет>
//
// ВАЖНО: начисление покупок подтверждайте на сервере — в обработчике
// successful_payment — и храните баланс в БД. Клиентская выдача самоцветов
// в демо-игре сделана для наглядности.

const http = require('node:http');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = Number(process.env.PORT || 8080);

// Каталог должен совпадать с GEM_PACKS на клиенте (sku -> цена в Stars)
const CATALOG = {
  gems_30:   { title: '30 самоцветов',   gems: 30,   stars: 15 },
  gems_100:  { title: '100 самоцветов',  gems: 100,  stars: 49 },
  gems_350:  { title: '350 самоцветов',  gems: 350,  stars: 149 },
  gems_1000: { title: '1000 самоцветов', gems: 1000, stars: 349 },
  starter:   { title: 'Стартовый набор', gems: 200,  stars: 79 },
};

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 1. Создание счёта: GET /invoice?sku=gems_100
  if (url.pathname === '/invoice' && req.method === 'GET') {
    const sku = url.searchParams.get('sku');
    const item = CATALOG[sku];
    if (!item) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unknown sku' }));
    }

    const out = await tg('createInvoiceLink', {
      title: item.title,
      description: 'Покупка в игре «Мой город»',
      payload: sku,
      currency: 'XTR',
      prices: [{ label: item.title, amount: item.stars }],
    });

    if (!out.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: out.description || 'telegram error' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ link: out.result }));
  }

  // 2. Вебхук Telegram: POST /webhook/<секрет>
  if (url.pathname.startsWith('/webhook') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let update = {};
      try { update = JSON.parse(body); } catch (e) {}

      // Подтверждение перед оплатой
      if (update.pre_checkout_query) {
        await tg('answerPreCheckoutQuery', {
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true,
        });
      }

      // Успешная оплата
      if (update.message && update.message.successful_payment) {
        const sp = update.message.successful_payment;
        const userId = update.message.from && update.message.from.id;
        const sku = sp.invoice_payload;
        const item = CATALOG[sku];
        console.log('PAID:', { userId, sku, stars: sp.total_amount, currency: sp.currency });
        // TODO: начислить item.gems пользователю userId в вашей БД.
      }

      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`Payment backend на порту ${PORT}`);
  if (!BOT_TOKEN) console.log('⚠️  Задайте BOT_TOKEN — без него счета не создаются.');
});
