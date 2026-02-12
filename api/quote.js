export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { name, phone, address, service, urgency, details } = req.body;

    // Validate required fields
    if (!name || !phone || !address) {
      return res.status(400).json({ error: 'Name, phone, and address are required.' });
    }

    // Run all three in parallel
    const results = await Promise.allSettled([
      createAirtableRecord({ name, phone, address, service, urgency, details }),
      sendSMS({ name, phone, address, service, urgency, details }),
      sendEmail({ name, phone, address, service, urgency, details }),
    ]);

    // Check results
    const [airtable, sms, email] = results;
    const errors = [];

    if (airtable.status === 'rejected') {
      console.error('Airtable error:', airtable.reason);
      errors.push('airtable');
    }
    if (sms.status === 'rejected') {
      console.error('SMS error:', sms.reason);
      errors.push('sms');
    }
    if (email.status === 'rejected') {
      console.error('Email error:', email.reason);
      errors.push('email');
    }

    // Even if notifications fail, the quote was received — don't tell the customer it failed
    // Just log the errors for debugging
    if (errors.length > 0) {
      console.warn('Some notifications failed:', errors.join(', '));
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Quote handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please call us instead.' });
  }
}

// ─── AIRTABLE ───
async function createAirtableRecord(data) {
  const resp = await fetch(
    `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [
          {
            fields: {
              Name: data.name,
              Phone: data.phone,
              Address: data.address,
              Service: data.service || undefined,
              Urgency: data.urgency || undefined,
              Details: data.details || '',
              Status: 'New',
            },
          },
        ],
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Airtable ${resp.status}: ${err}`);
  }

  return resp.json();
}

// ─── SMS VIA TEXTBELT ───
async function sendSMS(data) {
  const message = [
    `\ud83c\udf3f New WeMow760 Quote`,
    ``,
    `Name: ${data.name}`,
    `Phone: ${data.phone}`,
    `Address: ${data.address}`,
    data.service ? `Service: ${data.service}` : null,
    data.urgency ? `Urgency: ${data.urgency}` : null,
    data.details ? `Details: ${data.details}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: process.env.NOTIFY_PHONE,
      message,
      key: process.env.TEXTBELT_API_KEY,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Textbelt ${resp.status}: ${err}`);
  }

  const result = await resp.json();
  if (!result.success) {
    throw new Error(`Textbelt failed: ${result.error}`);
  }

  return result;
}

// ─── EMAIL VIA RESEND ───
async function sendEmail(data) {
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 500px;">
      <h2 style="color: #00BF66; margin-bottom: 4px;">New Quote Request</h2>
      <p style="color: #888; margin-top: 0; font-size: 14px;">${timestamp}</p>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: 600; width: 100px;">Name</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">${data.name}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: 600;">Phone</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
            <a href="tel:${data.phone}" style="color: #00BF66;">${data.phone}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: 600;">Address</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">${data.address}</td>
        </tr>
        ${data.service ? `<tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: 600;">Service</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">${data.service}</td>
        </tr>` : ''}
        ${data.urgency ? `<tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; font-weight: 600;">Urgency</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">${data.urgency}</td>
        </tr>` : ''}
        ${data.details ? `<tr>
          <td style="padding: 10px 0; font-weight: 600; vertical-align: top;">Details</td>
          <td style="padding: 10px 0;">${data.details}</td>
        </tr>` : ''}
      </table>
    </div>
  `;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'WeMow760 <notifications@wemow760.com>',
      to: [process.env.NOTIFY_EMAIL],
      subject: `New Quote — ${data.name}${data.service ? ` (${data.service})` : ''}`,
      html,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Resend ${resp.status}: ${err}`);
  }

  return resp.json();
}
