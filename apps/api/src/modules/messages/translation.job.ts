import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { Translate } from '@google-cloud/translate/build/src/v2';

@Processor('translations')
export class TranslationProcessor {
  private readonly logger = new Logger(TranslationProcessor.name);
  private readonly translateClient: Translate;

  constructor(private prisma: PrismaService) {
    // Initialize Google Cloud Translate client
    this.translateClient = new Translate({
      key: process.env.GOOGLE_TRANSLATE_API_KEY,
    });
  }

  @Process()
  async handleTranslation(
    job: Job<{ messageId: string; targetLang: string }>,
  ): Promise<void> {
    const { messageId, targetLang } = job.data;

    this.logger.log(
      `Translating message ${messageId} to ${targetLang}`,
    );

    try {
      // Fetch the message
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        this.logger.warn(`Message ${messageId} not found, skipping translation`);
        return;
      }

      // Check if translation already exists
      const existingTranslations =
        (message.translated_bodies as Record<string, string>) || {};

      if (existingTranslations[targetLang]) {
        this.logger.log(
          `Translation for ${targetLang} already exists, skipping`,
        );
        return;
      }

      // Call Google Translate API
      const [translation] = await this.translateClient.translate(
        message.body,
        targetLang,
      );

      // Update message with translated body
      const updatedTranslations = {
        ...existingTranslations,
        [targetLang]: translation,
      };

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          translated_bodies: updatedTranslations,
        },
      });

      this.logger.log(
        `Successfully translated message ${messageId} to ${targetLang}`,
      );
    } catch (error) {
      // Log error at warn level but don't fail the job
      // Message is still readable in original language
      this.logger.warn(
        `Translation failed for message ${messageId} to ${targetLang}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Don't throw — allow job to complete
    }
  }
}
