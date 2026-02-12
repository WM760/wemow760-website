export default function handler(req, res) {
  const vars = [
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'AIRTABLE_TABLE_ID',
    'TEXTBELT_API_KEY',
    'NOTIFY_PHONE',
    'NOTIFY_EMAIL',
    'RESEND_API_KEY',
  ];

  const status = {};
  for (const v of vars) {
    const val = process.env[v];
    status[v] = val ? `SET (${val.length} chars, starts with "${val.slice(0, 4)}...")` : 'MISSING';
  }

  return res.status(200).json(status);
}
