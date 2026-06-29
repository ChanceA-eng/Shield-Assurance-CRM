interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: string;
    type?: string;
  }>;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    throw new Error('SendGrid is not configured. Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL.');
  }

  // ✅ CORRECTED PAYLOAD: SendGrid v3 strictly requires 'subject' at the root level
  const attachments = (payload.attachments ?? []).map((attachment) => ({
    content: attachment.content,
    filename: attachment.filename,
    type: attachment.type || 'application/octet-stream',
    disposition: 'attachment',
  }));

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        { 
          to: [{ email: payload.to.trim().toLowerCase() }] 
        }
      ],
      from: { 
        email: fromEmail.trim().toLowerCase() 
      },
      subject: payload.subject.trim(), // Mandatory top-level property
      content: [
        { 
          type: 'text/plain', 
          value: payload.body.trim() 
        }
      ],
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'No response body');
    console.error('SendGrid email request failed', {
      status: response.status,
      to: payload.to,
      subject: payload.subject,
      responseDetails: errorBody,
    });
    throw new Error(`SendGrid request failed (${response.status}): ${errorBody}`);
  }
}