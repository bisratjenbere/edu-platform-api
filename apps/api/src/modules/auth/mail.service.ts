import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit(): void {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    const from = this.configService.get<string>('MAIL_FROM')?.trim();

    if (!host || !from) {
      this.logger.warn(
        'SMTP_HOST or MAIL_FROM not set — outbound email will be logged only',
      );
      return;
    }

    const port = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS')?.trim();

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    this.logger.log(`SMTP configured (${host}:${port})`);
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(options: SendMailOptions): Promise<void> {
    const from = this.configService.get<string>('MAIL_FROM')?.trim();

    if (!this.transporter || !from) {
      this.logger.debug(
        `[mail:not-sent] to=${options.to} subject="${options.subject}"\n${options.text}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
  }

  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    const appName = this.configService.get<string>('APP_NAME') || 'EduFlow';
    const ttlMinutes = Math.floor(
      (parseInt(
        this.configService.get<string>('PASSWORD_RESET_TTL_SECONDS') || '900',
        10,
      ) || 900) / 60,
    );

    await this.send({
      to,
      subject: `${appName} password reset code`,
      text: [
        `Your ${appName} password reset code is: ${code}`,
        '',
        `This code expires in ${ttlMinutes} minutes.`,
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html: `
        <p>Your <strong>${appName}</strong> password reset code is:</p>
        <p style="font-size:24px;font-weight:bold;letter-spacing:2px">${code}</p>
        <p>This code expires in ${ttlMinutes} minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      `,
    });
  }

  async sendFamilyInviteEmail(
    to: string,
    acceptUrl: string,
    context: { studentName: string; className: string },
  ): Promise<void> {
    const appName = this.configService.get<string>('APP_NAME') || 'EduFlow';

    await this.send({
      to,
      subject: `${appName}: connect to ${context.studentName}'s class`,
      text: [
        `You have been invited to connect as a family member for ${context.studentName} in ${context.className}.`,
        '',
        `Accept the invite here (expires in 7 days):`,
        acceptUrl,
      ].join('\n'),
      html: `
        <p>You have been invited to connect as a family member for
          <strong>${context.studentName}</strong> in <strong>${context.className}</strong>.</p>
        <p><a href="${acceptUrl}">Accept invite</a> (expires in 7 days)</p>
      `,
    });
  }
}
