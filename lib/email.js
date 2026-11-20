import 'server-only';

// Sends plain, quiet emails through Resend's HTTP API. With no RESEND_API_KEY
// set (local development), the message is printed to the server log instead.
export async function sendEmail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Cairn <onboarding@resend.dev>';
  if (!key) {
    console.log(`[email] to=${to} subject="${subject}"\n${text}\n`);
    return { ok: true, logged: true };
  }
  const base = process.env.RESEND_API_URL || 'https://api.resend.com';
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      console.error('[email] Resend refused the message', res.status, await res.text().catch(() => ''));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('[email] could not reach Resend', err?.message);
    return { ok: false };
  }
}
