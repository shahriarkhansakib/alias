interface MailpitAddress {
  Address: string;
}

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  To: MailpitAddress[];
  Created: string;
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[];
}

interface MailpitMessageDetail {
  ID: string;
  Text: string;
  HTML: string;
}

function getMailpitUrl(): string {
  return (process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8025').replace(/\/+$/, '');
}

export async function waitForVerificationLink(recipientEmail: string): Promise<string> {
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  const baseUrl = getMailpitUrl();
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/messages`);
    if (response.ok) {
      const payload = (await response.json()) as MailpitMessagesResponse;
      const matching = payload.messages.find((message) =>
        message.To.some((addr) => addr.Address.toLowerCase() === normalizedRecipient),
      );

      if (matching) {
        const detailResponse = await fetch(`${baseUrl}/api/v1/message/${matching.ID}`);
        if (detailResponse.ok) {
          const detail = (await detailResponse.json()) as MailpitMessageDetail;
          const match = detail.Text.match(/https?:\/\/\S+/);
          if (match?.[0]) {
            return match[0];
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Mailpit verification email for ${recipientEmail}`);
}
