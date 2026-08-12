const { Resend } = require("resend");
const env = require("../config/env");
const logger = require("../utils/logger");

let resend = null;
if (env.email.apiKey) {
  resend = new Resend(env.email.apiKey);
}

const sendEmail = async ({ to, subject, html }) => {
  if (!env.email.apiKey || !resend) {
    logger.warn("RESEND_API_KEY is missing.");
    return { sent: false, reason: "RESEND_NOT_CONFIGURED" };
  }

  try {
  const { data, error } = await resend.emails.send({
    from: env.email.from,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error("Resend Error:", error);
    return {
      sent: false,
      reason: error.message,
    };
  }

  logger.info(`Email sent to ${to}. Email ID: ${data?.id}`);

  return {
    sent: true,
  };
} catch (err) {
  logger.error("Resend Error:", err);

  return {
    sent: false,
    reason: err.message,
  };
}
};

const sendVerificationEmail = (to, verifyUrl) =>
  sendEmail({
    to,
    subject: "Verify your MindMitra account",
    html: `
<div style="font-family: Arial, sans-serif; max-width:600px; margin:auto;">
  <h2>Welcome to MindMitra 💙</h2>

  <p>Thank you for creating your account.</p>

  <p>Please click the button below to verify your email address.</p>

  <a href="${verifyUrl}"
     style="
        background:#2563eb;
        color:white;
        padding:12px 20px;
        text-decoration:none;
        border-radius:6px;
        display:inline-block;
     ">
      Verify Email
  </a>

  <p style="margin-top:20px;">
    This verification link will expire in 24 hours.
  </p>

  <p>
    If you didn't create this account, you can safely ignore this email.
  </p>
</div>
`,
  });

const sendPasswordResetEmail = (to, resetUrl) =>
  sendEmail({
    to,
    subject: "Reset your password",
    html: `
      <h2>Reset Password</h2>
      <p>Click below to reset your password.</p>
      <a href="${resetUrl}">Reset Password</a>
    `,
  });

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
};