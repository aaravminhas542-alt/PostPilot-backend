require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Stripe = require('stripe');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://exquisite-douhua-17aaf8.netlify.app').replace(/\/$/, '');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Allow requests without Origin for health checks and command-line tools.
    if (!origin || origin === FRONTEND_URL) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a little while.' }
});
app.use('/api', apiLimiter);

// Stripe requires the unparsed request body to validate webhook signatures.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  }

  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send('Invalid webhook signature');
  }

  // TODO: Persist these events and update a database-backed subscription record.
  // Do not grant paid access based only on the browser's success redirect.
  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'invoice.paid':
    case 'invoice.payment_failed':
      console.log(`Received verified Stripe event: ${event.type} (${event.id})`);
      break;
    default:
      console.log(`Ignoring Stripe event: ${event.type}`);
  }

  return res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'postpilot-ai-backend' });
});

app.post('/api/generate', async (req, res) => {
  const { business, platform, tone, goal, audience, offer, notes } = req.body || {};

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'Content generation is not configured yet. Add OPENAI_API_KEY to the server environment.' });
  }
  if (typeof business !== 'string' || business.trim().length < 2 || business.length > 180) {
    return res.status(400).json({ error: 'Please provide a business or brand name (2–180 characters).' });
  }

  const clean = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const brief = {
    business: clean(business, 180),
    platform: clean(platform || 'Instagram', 80),
    tone: clean(tone || 'friendly and engaging', 100),
    goal: clean(goal || 'increase engagement', 200),
    audience: clean(audience || 'potential customers', 200),
    offer: clean(offer, 300),
    notes: clean(notes, 600)
  };

  const systemPrompt = `You are PostPilot AI, a practical social-media content strategist. Create exactly 7 distinct social media posts based on the user's business brief. Return only valid JSON in this shape: {"posts":[{"day":1,"caption":"...","hashtags":["#example"],"visual_idea":"...","call_to_action":"..."}]}. Captions must be original, platform-appropriate, useful, and not make unsupported claims. Keep each caption reasonably concise. Do not include markdown fences.`;
  const userPrompt = `Create a seven-post content pack for this brief:\n${JSON.stringify(brief, null, 2)}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI API error:', data.error?.message || response.statusText);
      return res.status(502).json({ error: 'The content service could not complete the request. Check the server logs and API configuration.' });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) return res.status(502).json({ error: 'The content service returned an empty response.' });

    let result;
    try { result = JSON.parse(content); }
    catch { return res.status(502).json({ error: 'The content service returned an invalid response. Please try again.' }); }

    if (!Array.isArray(result.posts) || result.posts.length !== 7) {
      return res.status(502).json({ error: 'The content service did not return exactly seven posts. Please try again.' });
    }
    return res.json({ posts: result.posts });
  } catch (err) {
    console.error('Generation request failed:', err.message);
    return res.status(500).json({ error: 'Unexpected error while generating content.' });
  }
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to the server environment.' });

  const plan = req.body?.plan;
  const priceId = plan === 'pro'
    ? process.env.STRIPE_PRO_PRICE_ID
    : plan === 'studio'
      ? process.env.STRIPE_STUDIO_PRICE_ID
      : null;

  if (!priceId) return res.status(400).json({ error: 'Choose a valid plan: pro or studio.' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto'
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout creation failed:', err.message);
    return res.status(502).json({ error: 'Could not start checkout. Verify the Stripe test-mode price IDs and server key.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'This website is not allowed to call the API.' });
  }
  console.error('Unhandled server error:', err.message);
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`PostPilot AI backend listening on port ${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_URL}`);
});
