const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
};

async function sendPasswordResetEmail(toEmail, resetToken) {
  const transporter = createTransporter();
  const resetUrl = `${process.env.PUBLIC_URL || 'http://localhost:5000'}/reset-password.html?token=${resetToken}`;

  if (!transporter) {
    console.log(`[Email Service Simulation] Password reset token for ${toEmail}: ${resetToken}`);
    console.log(`Reset link: ${resetUrl}`);
    return { simulated: true, resetUrl };
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || '"Amar Bangladesh" <no-reply@amar-bangladesh.com>',
    to: toEmail,
    subject: 'পাসওয়ার্ড রিসেট লিংক - আমার বাংলাদেশ',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>আমার বাংলাদেশ - পাসওয়ার্ড রিসেট করুন</h2>
        <p>আপনি আপনার পাসওয়ার্ড পুনর্নির্ধারণের অনুরোধ করেছেন। পাসওয়ার্ড পরিবর্তন করতে নিচের বোতামে ক্লিক করুন:</p>
        <a href="${resetUrl}" style="background-color: #087653; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">পাসওয়ার্ড রিসেট করুন</a>
        <p style="margin-top: 15px;">অথবা লিংকটি ব্রাউজারে কপি করে পেস্ট করুন:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <small style="color: #888;">এই লিংকটি ১ ঘণ্টার জন্য সক্রিয় থাকবে। আপনি যদি অনুরোধ না করে থাকেন তবে এই ইমেইলটি উপেক্ষা করুন।</small>
      </div>
    `
  };

  return await transporter.sendMail(mailOptions);
}

module.exports = { sendPasswordResetEmail };
