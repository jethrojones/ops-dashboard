// Failure email delivery via Resend.
// Emails are summary-only: no API payloads, no credential fragments, no PII.
// Styled with the Glassline palette (white surface, cobalt accent). Edit the
// `TOKENS` block below or rewrite the HTML to match a different design.

const RESEND_API = 'https://api.resend.com/emails';

export interface FailureEmailParams {
  workflowName: string;
  workflowId: string;
  runId: string;
  errorCategory: string;
  errorSummary: string;
  startedAt: string;
  durationMs: number | null;
  appDomain: string;
  toEmails: string[];
  fromEmail: string;
  resendApiKey: string;
}

// Inline tokens — email clients can't read CSS variables, so we hard-code.
// Keep in sync with design.md / src/frontend/styles.ts.
const TOKENS = {
  primary:     '#0F1419',
  secondary:   '#4A5568',
  tertiary:    '#2C5EF5',
  neutral:     '#F1F3F5',
  surface:     '#FFFFFF',
  onPrimary:   '#FFFFFF',
  border:      '#E5E7EB',
  danger:      '#B91C1C',
  dangerBg:    '#FEF2F2',
  textMuted:   '#4A5568',
  textSubtle:  '#6B7280',
};

const FONT_STACK = "'Geist','Helvetica Neue',Arial,sans-serif";
const FONT_MONO  = "'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace";

export async function sendFailureEmail(p: FailureEmailParams): Promise<boolean> {
  const runUrl = `https://${p.appDomain}/workflows/${p.workflowId}/runs/${p.runId}`;
  const connectionsUrl = `https://${p.appDomain}/settings/connections`;
  const startedFmt = new Date(p.startedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const durationFmt = p.durationMs != null
    ? p.durationMs < 1000 ? `${p.durationMs}ms` : `${(p.durationMs / 1000).toFixed(1)}s`
    : 'unknown';
  const categoryLabel: Record<string, string> = {
    auth: 'API authentication error',
    rate_limit: 'API rate limit',
    network: 'network timeout',
    schema: 'data format mismatch',
    unknown: 'unexpected error',
  };
  const label = categoryLabel[p.errorCategory] ?? p.errorCategory;

  const button = (href: string, text: string, opts: { bg: string; fg: string; border?: string }): string =>
    `<a href="${href}" target="_blank" style="display:inline-block;background:${opts.bg};color:${opts.fg} !important;text-decoration:none;border-radius:10px;padding:12px 22px;font-family:${FONT_STACK};font-weight:600;font-size:14px;letter-spacing:-0.01em;border:1px solid ${opts.border ?? opts.bg};line-height:1;"><span style="color:${opts.fg};">${escHtml(text)}</span></a>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escHtml(p.workflowName)} failed</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${TOKENS.neutral};font-family:${FONT_STACK};color:${TOKENS.primary};-webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${TOKENS.neutral};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${TOKENS.surface};border-radius:16px;overflow:hidden;border:1px solid ${TOKENS.border};">

        <tr>
          <td style="padding:32px 36px 0;">
            <div style="font-family:${FONT_MONO};font-weight:500;font-size:11px;letter-spacing:0;text-transform:uppercase;color:${TOKENS.tertiary};margin-bottom:14px;">Workflow failed</div>
            <h1 style="margin:0 0 8px;font-family:${FONT_STACK};font-weight:600;font-size:28px;line-height:1.15;letter-spacing:-0.02em;color:${TOKENS.primary};">${escHtml(p.workflowName)}</h1>
            <p style="margin:0;font-family:${FONT_STACK};font-size:15px;font-weight:500;color:${TOKENS.textMuted};">${escHtml(label)}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${TOKENS.dangerBg};border-left:3px solid ${TOKENS.danger};border-radius:10px;margin-bottom:24px;">
              <tr>
                <td style="padding:14px 18px;font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${TOKENS.primary};">
                  ${escHtml(p.errorSummary)}
                </td>
              </tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:28px;">
              ${metaRow('Run ID', p.runId, false)}
              ${metaRow('Started', startedFmt, false)}
              ${metaRow('Duration', durationFmt, false)}
              ${metaRow('Error type', label, true)}
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:10px;">${button(runUrl, 'Open run detail', { bg: TOKENS.tertiary, fg: TOKENS.onPrimary })}</td>
                <td>${button(connectionsUrl, 'Open connections', { bg: TOKENS.surface, fg: TOKENS.primary, border: TOKENS.border })}</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="background:${TOKENS.neutral};padding:16px 36px;border-top:1px solid ${TOKENS.border};font-family:${FONT_MONO};font-size:11px;color:${TOKENS.textSubtle};">
            <a href="https://${escHtml(p.appDomain)}" style="color:${TOKENS.tertiary};text-decoration:none;font-weight:500;">${escHtml(p.appDomain)}</a>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  try {
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Ops Dashboard <${p.fromEmail}>`,
        to: p.toEmails,
        subject: `${p.workflowName} — failed: ${label}`,
        html,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function metaRow(key: string, value: string, isLast = false): string {
  const isMono = /^[a-f0-9-]{8,}$/i.test(value);
  return `<tr>
    <td style="padding:10px 0;border-bottom:${isLast ? 'none' : `1px solid ${TOKENS.border}`};font-family:${FONT_MONO};font-size:11px;font-weight:500;letter-spacing:0;text-transform:uppercase;color:${TOKENS.textMuted};white-space:nowrap;width:110px;vertical-align:top;">${escHtml(key)}</td>
    <td style="padding:10px 0;border-bottom:${isLast ? 'none' : `1px solid ${TOKENS.border}`};font-family:${isMono ? FONT_MONO : FONT_STACK};font-size:13px;font-weight:${isMono ? '500' : '600'};color:${TOKENS.primary};word-break:break-all;">${escHtml(value)}</td>
  </tr>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
