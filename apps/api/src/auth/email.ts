import type { Env } from "../env.ts";

// All emails (confirm your email, reset your password) are sent through one
// function called sendEmail. Which version you get depends on NODE_ENV:
//   test        -> the email is saved in a list, so tests can read it
//   development -> the link is printed in your terminal
//   production  -> the email is really sent, through Resend
// See spec 0003, "Value sourcing: emails".

export type Email = {
  to: string;
  subject: string;
  text: string;
  url: string; // the link the fan has to open
};

export type SendEmail = (email: Email) => Promise<void>;

// Tests only: every email "sent" during the test run.
const sentEmails: Email[] = [];

// Tests only: returns the newest email sent to this address.
export function getLastEmail(to: string): Email | undefined {
  const address = to.toLowerCase();
  let newest: Email | undefined = undefined;
  for (const email of sentEmails) {
    if (email.to === address) {
      newest = email;
    }
  }
  return newest;
}

export function createSendEmail(env: Env): SendEmail {
  if (env.NODE_ENV === "test") {
    return saveEmailForTests;
  }
  if (env.NODE_ENV === "production") {
    return createResendSender(env);
  }
  return printEmailInTerminal;
}

async function saveEmailForTests(email: Email) {
  sentEmails.push({ ...email, to: email.to.toLowerCase() });
}

async function printEmailInTerminal(email: Email) {
  console.log("");
  console.log(`[email] to ${email.to}: ${email.subject}`);
  console.log(`        ${email.url}`);
  console.log("");
}

// Sends real emails with Resend's HTTP API (https://resend.com/docs).
function createResendSender(env: Env): SendEmail {
  // env.ts already refuses to start in production without these two.
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  return async function sendWithResend(email: Email) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from,
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
    });

    if (!response.ok) {
      const reason = await response.text();
      throw new Error(`Resend refused the email (${response.status}): ${reason}`);
    }
  };
}
