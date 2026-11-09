import nodemailer from "nodemailer";
import {
  verificationEmailHTML,
  verificationEmailText,
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

interface SendVerificationEmailInput {
  to: string;
  name: string;
  verificationUrl: string;
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
    // Spec order-communications §5.2: timeout transport WAJIB lebih pendek
    // daripada lease claim lima menit, supaya satu dispatch tidak pernah
    // memegang claim melewati lease-nya.
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
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

export interface EmailDeliveryReceipt {
  accepted: string[];
  rejected: string[];
}

/**
 * Kirim satu pesan dan kembalikan bukti penerimaan server email.
 *
 * Kontrak `sendEmail` di atas SENGAJA tidak berubah (email autentikasi tetap
 * memakai jalur yang sama), sedangkan antrean email order butuh menerima /
 * menolak per penerima untuk mengklasifikasikan hasil.
 */
export async function sendEmailMessage(
  input: SendEmailInput
): Promise<EmailDeliveryReceipt> {
  const from = process.env.SMTP_FROM || BRAND_SUPPORT_EMAIL;
  const transport = getTransporter();

  const info = await transport.sendMail({
    from: `${BRAND_NAME} <${from}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  return {
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
    rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
  };
}

export async function sendVerificationEmail(
  input: SendVerificationEmailInput
): Promise<void> {
  const html = verificationEmailHTML({
    url: input.verificationUrl,
    name: input.name,
  });
  const text = verificationEmailText({
    url: input.verificationUrl,
    name: input.name,
  });

  await sendEmail({
    to: input.to,
    subject: `Verify your email address — ${BRAND_NAME}`,
    html,
    text,
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