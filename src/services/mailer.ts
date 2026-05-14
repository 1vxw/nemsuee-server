import nodemailer from "nodemailer";

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value != null && String(value).trim() !== "")
      return String(value).trim();
  }
  return "";
}

function normalizeFrontendUrl(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "");
}

function getFrontendUrl() {
  const url = process.env.FRONTEND_URL || "";
  if (!url) throw new Error("FRONTEND_URL is not configured");
  return normalizeFrontendUrl(url);
}

export function buildFrontendLink(
  path: string,
  params?: Record<string, string>,
) {
  const base = getFrontendUrl();
  const url = new URL(base + (path.startsWith("/") ? path : `/${path}`));
  for (const [k, v] of Object.entries(params || {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmailShell({
  title,
  preheader,
  bodyHtml,
}: {
  title: string;
  preheader: string;
  bodyHtml: string;
}) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,700;1,400&family=Manrope:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f9f9fe;font-family:'Manrope','Inter','Segoe UI',Arial,sans-serif;color:#1a1c1f;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9f9fe;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:760px;background:#f9f9fe;">

            <!-- Header Nav -->
            <tr>
              <td style="padding:16px 12px 24px 12px;border-bottom:1px solid #e2e2e7;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#001d44;">NEMSU E-LEARNING ENVIRONMENT</td>
                    <td align="right" style="font-family:'Manrope','Inter',Arial,sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#737780;">
                      <span style="margin-right:16px;">UNIVERSITY</span>
                      <span style="margin-right:16px;">ACADEMICS</span>
                      <span>RESEARCH</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:0 12px;">
                ${bodyHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:20px 18px 10px 18px;text-align:center;">
                <!-- Seal / Logo placeholder -->
                <div style="width:48px;height:48px;border-radius:50%;background:#e2e2e7;margin:0 auto 8px auto;display:flex;align-items:center;justify-content:center;">
                  <span style="font-family:'Noto Serif',Georgia,serif;font-size:10px;color:#43474f;letter-spacing:1px;">SEAL</span>
                </div>
                <div style="font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:15px;color:#001d44;font-weight:700;letter-spacing:1px;">NEMSUEE</div>
                <p style="margin:4px 0 0 0;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#737780;">OFFICE OF THE REGISTRAR &amp; DIGITAL SERVICES</p>
              </td>
            </tr>

            <!-- Footer bar -->
            <tr>
              <td style="padding:18px 18px;border-top:1px solid #c3c6d1;background:#f4f3f8;text-align:center;">
                <div style="font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:16px;color:#001d44;font-style:italic;">NEMSU E-LEARNING ENVIRONMENT</div>
                <p style="margin:8px 0 6px 0;font-size:10px;letter-spacing:1px;color:#737780;">
                  <a href="#" style="color:#737780;text-decoration:none;margin:0 8px;">SECURITY POLICY</a>
                  <a href="#" style="color:#001d44;text-decoration:underline;margin:0 8px;font-weight:600;">VERIFICATION PORTAL</a>
                  <a href="#" style="color:#737780;text-decoration:none;margin:0 8px;">PRIVACY OFFICE</a>
                </p>
                <p style="margin:6px 0 0 0;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:#737780;">&copy; 2026 NEMSU INSTITUTIONAL COMMUNICATIONS. THIS IS A SECURE ACADEMIC TRANSMISSION.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return { html };
}

export function renderVerificationEmail({
  actionUrl,
  otp,
  expiresMinutes = 10,
}: {
  actionUrl: string;
  otp?: string;
  expiresMinutes?: number;
}) {
  const safeActionUrl = escapeHtml(actionUrl);

  // Render OTP digits as individual boxes if provided
  const otpDigits = otp
    ? otp
        .split("")
        .map(
          (d) =>
            `<td style="padding:0 4px;">
              <div style="width:44px;height:56px;background:#f4f3f8;border:1px solid #c3c6d1;border-radius:8px;display:inline-block;text-align:center;line-height:56px;font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#001d44;">${escapeHtml(d)}</div>
            </td>`,
        )
        .join("")
    : "";

  const otpBlock = otp
    ? `
    <tr>
      <td style="padding:20px 0 4px 0;">
        <p style="margin:0 0 10px 0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#737780;">TEMPORARY ACCESS TOKEN</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
          <tr>${otpDigits}</tr>
        </table>
      </td>
    </tr>`
    : "";

  const bodyHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9f9fe;">

    <!-- Main card row: left text + right OTP -->
    <tr>
      <td style="padding:28px 0 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e2e2e7;border-radius:12px;">
          <tr>
            <!-- Left: heading + body copy -->
            <td valign="top" style="padding:34px 28px 30px 30px;width:55%;">
              <h1 style="margin:0 0 16px 0;font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:36px;line-height:1.15;color:#001d44;">
                Institutional<br/>Identity<br/><span style="color:#775a19;">Verification</span>
              </h1>
              <p style="margin:0;font-size:14px;line-height:1.75;color:#43474f;max-width:300px;">
                To maintain the integrity of the NEMSU E-LEARNING ENVIRONMENT, we require secure verification of your academic credentials. Please use the administrative code provided below to authenticate your portal access.
              </p>
            </td>

            <!-- Right: OTP box -->
            <td valign="top" style="padding:30px 24px 30px 0;width:45%;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9f9fe;border:1px solid #c3c6d1;border-radius:10px;padding:20px 18px;width:100%;max-width:220px;">
                ${otpBlock ? `<tr><td>${otpBlock.replace(/<tr>|<\/tr>/g, "")}</td></tr>` : ""}
                <tr>
                  <td style="padding:${otp ? "12px 0 10px" : "20px 0 10px"} 0;">
                    <a href="${safeActionUrl}" style="display:block;text-align:center;background:#001d44;color:#ffffff;text-decoration:none;font-family:'Inter','Manrope',Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;padding:13px 10px;border-radius:7px;">VERIFY ACCOUNT</a>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;">
                    <p style="margin:0;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#737780;">CODE EXPIRES IN <span style="color:#ba1a1a;font-weight:700;">${expiresMinutes}:00 MINUTES</span></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Security Advisory -->
    <tr>
      <td style="padding:0 0 24px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f3f8;border-left:4px solid #775a19;border-radius:10px;">
          <tr>
            <!-- Shield icon cell -->
            <td valign="top" style="padding:18px 16px 18px 20px;width:36px;">
              <div style="width:28px;height:28px;background:#775a19;border-radius:50%;text-align:center;line-height:28px;font-size:14px;color:#ffffff;">&#10003;</div>
            </td>
            <!-- Text -->
            <td style="padding:18px 20px 18px 0;">
              <h3 style="margin:0 0 5px 0;font-family:'Noto Serif',Georgia,'Times New Roman',serif;color:#001d44;font-size:17px;">Security Advisory</h3>
              <p style="margin:0 0 10px 0;font-size:13px;line-height:1.65;color:#43474f;">This is an encrypted transmission from the NEMSUEE Verification Office. If you did not initiate this request, your account may be at risk. Access to the Digital Athenaeum is strictly monitored under the Institutional Communications Security Act.</p>
              <p style="margin:0;font-size:11px;letter-spacing:1px;text-transform:uppercase;">
                <a href="#" style="color:#ba1a1a;font-weight:700;text-decoration:none;margin-right:14px;">REPORT UNAUTHORIZED ACCESS</a>
                <a href="#" style="color:#001d44;font-weight:600;text-decoration:none;">SECURITY PROTOCOLS</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
  `.trim();

  const shell = renderEmailShell({
    title: "NEMSU E-LEARNING ENVIRONMENT - Email Verification",
    preheader: "Verify your NEMSUEE account",
    bodyHtml,
  });

  return {
    html: shell.html,
    text: `Institutional Identity Verification\n\nPlease verify your account: ${actionUrl}\n\n${otp ? `Your access code: ${otp}\n\n` : ""}This link expires in ${expiresMinutes} minutes.\n\nIf you did not request this, ignore this email.`,
  };
}

export function renderPasswordResetEmail({ actionUrl }: { actionUrl: string }) {
  const safeActionUrl = escapeHtml(actionUrl);
  const bodyHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9f9fe;">
    <tr>
      <td style="padding:0 0 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e2e2e7;border-radius:12px;">
          <tr>
            <td style="padding:34px 30px 30px 30px;">
              <h1 style="margin:0 0 14px 0;font-family:'Noto Serif',Georgia,'Times New Roman',serif;font-size:36px;line-height:1.2;color:#001d44;">Security Verification: <span style="color:#775a19;">Password Reset Protocol</span></h1>
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.7;color:#43474f;">We received a request to reset the credentials associated with your NEMSUEE academic portal.</p>
              <p style="margin:0 0 22px 0;font-size:16px;line-height:1.7;color:#43474f;">Use the secure link below to authorize this change.</p>
              <a href="${safeActionUrl}" style="display:inline-block;background:#001d44;color:#ffffff;text-decoration:none;font-family:'Inter','Manrope','Segoe UI',Arial,sans-serif;font-weight:600;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;padding:14px 22px;border-radius:8px;">Reset Password</a>
              <p style="margin:14px 0 0 0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#775a19;font-weight:700;">Link authorization expires in 1 hour</p>
              <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:#737780;word-break:break-all;">If the button does not work, use this link: ${safeActionUrl}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 0 18px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f3f8;border-left:4px solid #775a19;border-radius:12px;">
          <tr>
            <td style="padding:18px 20px;">
              <h3 style="margin:0 0 6px 0;font-family:'Noto Serif',Georgia,'Times New Roman',serif;color:#001d44;font-size:20px;">Institutional Safeguard</h3>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#43474f;">If you did not request this action, no further action is required. Your current credentials remain secure.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  `.trim();

  const shell = renderEmailShell({
    title: "NEMSUEE | Secure Transmission",
    preheader: "Password reset request",
    bodyHtml,
  });

  return {
    html: shell.html,
    text: `Password Reset Protocol\n\nReset your password: ${actionUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request this, ignore this email.`,
  };
}

function loadSmtpConfig() {
  const host = firstEnv(
    "SMTP_HOST",
    "APPSETTING_SMTP_HOST",
    "AZURE_SMTP_HOST",
    "MAIL_HOST",
  );
  const portRaw = firstEnv(
    "SMTP_PORT",
    "APPSETTING_SMTP_PORT",
    "AZURE_SMTP_PORT",
    "MAIL_PORT",
  );
  const user = firstEnv(
    "SMTP_USER",
    "APPSETTING_SMTP_USER",
    "AZURE_SMTP_USER",
    "MAIL_USERNAME",
    "MAIL_USER",
  );
  const pass = firstEnv(
    "SMTP_PASS",
    "APPSETTING_SMTP_PASS",
    "AZURE_SMTP_PASS",
    "MAIL_PASSWORD",
    "MAIL_PASS",
  );
  const from =
    firstEnv(
      "SMTP_FROM",
      "APPSETTING_SMTP_FROM",
      "AZURE_SMTP_FROM",
      "MAIL_FROM",
    ) ||
    user ||
    "no-reply@nemsuee.local";
  const secureRaw = firstEnv(
    "SMTP_SECURE",
    "APPSETTING_SMTP_SECURE",
    "AZURE_SMTP_SECURE",
    "MAIL_SECURE",
  );

  const port = Number(portRaw || 587);
  const secure = secureRaw.toLowerCase() === "true";

  return { host, port, user, pass, from, secure };
}

function mailConfigured() {
  const { host, user, pass } = loadSmtpConfig();
  if (!host) return false;
  if (user && !pass) return false;
  return true;
}

export async function sendMail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  if (!mailConfigured()) {
    console.log("[mail:dev]", { to, subject, text: text || "(no text)", html });
    return;
  }

  const { host, port, user, pass, from, secure } = loadSmtpConfig();

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });

    if (process.env.NODE_ENV !== "production") {
      await transporter.verify();
    }

    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text,
    });
  } catch (err) {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) throw err;
    console.error("[mail:error:fallback]", err);
    console.log("[mail:dev:fallback]", { to, subject, text: text || "(no text)", html });
  }
}
