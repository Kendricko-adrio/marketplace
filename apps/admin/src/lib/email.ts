import nodemailer from "nodemailer";
import {
  resetPasswordEmailHTML,
  resetPasswordEmailText,
} from "@/lib/email-templates";
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from "@/lib/email-config";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendResetPasswordEmailInput {
  to: string;
  name: string;
  resetUrl: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      "SMTP credentials are not configured. Set SMTP_USER and SMTP_PASS in your .env file (use a Gmail App Password, not your account password)."
    );
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return transporter;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const from = process.env.SMTP_FROM || BRAND_SUPPORT_EMAIL;
  const transport = getTransporter();

  await transport.sendMail({
    from: `${BRAND_NAME} <${from}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

export async function sendResetPasswordEmail(
  input: SendResetPasswordEmailInput
): Promise<void> {
  const html = resetPasswordEmailHTML({
    url: input.resetUrl,
    name: input.name,
  });
  const text = resetPasswordEmailText({
    url: input.resetUrl,
    name: input.name,
  });

  await sendEmail({
    to: input.to,
    subject: `Reset your password — ${BRAND_NAME}`,
    html,
    text,
  });
}