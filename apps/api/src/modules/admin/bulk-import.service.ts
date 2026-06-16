import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import * as bcrypt from 'bcrypt';

interface CsvRow {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface BulkImportResult {
  added: number;
  updated: number;
  errors: string[];
}

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(private prisma: PrismaService) {}

  async import(
    schoolId: string,
    adminId: string,
    fileBuffer: Buffer,
  ): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      added: 0,
      updated: 0,
      errors: [],
    };

    // Parse CSV
    let records: CsvRow[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      throw new BadRequestException('Invalid CSV format');
    }

    // Enforce max rows
    if (records.length > 1000) {
      throw new BadRequestException('CSV exceeds maximum 1000 rows');
    }

    // Validate headers
    const requiredColumns = ['email', 'first_name', 'last_name', 'role'];
    if (records.length > 0) {
      const actualColumns = Object.keys(records[0]);
      const missingColumns = requiredColumns.filter(
        (col) => !actualColumns.includes(col),
      );
      if (missingColumns.length > 0) {
        throw new BadRequestException(
          `Missing required columns: ${missingColumns.join(', ')}`,
        );
      }
    }

    // Process each row
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // 1-indexed, +1 for header row

      try {
        // Validate email
        if (!row.email || !this.isValidEmail(row.email)) {
          result.errors.push(`Row ${rowNum}: Invalid email format`);
          continue;
        }

        // Validate role
        if (row.role !== 'TEACHER' && row.role !== 'STUDENT') {
          result.errors.push(
            `Row ${rowNum}: Role must be TEACHER or STUDENT, got "${row.role}"`,
          );
          continue;
        }

        // Validate names
        if (!row.first_name || row.first_name.length > 100) {
          result.errors.push(
            `Row ${rowNum}: first_name required, max 100 chars`,
          );
          continue;
        }
        if (!row.last_name || row.last_name.length > 100) {
          result.errors.push(`Row ${rowNum}: last_name required, max 100 chars`);
          continue;
        }

        // Upsert user
        const existingUser = await this.prisma.user.findFirst({
          where: {
            email: row.email.toLowerCase().trim(),
            deleted_at: null,
          },
        });

        if (existingUser) {
          // Update existing user
          await this.prisma.user.update({
            where: { id: existingUser.id },
            data: {
              first_name: row.first_name.trim(),
              last_name: row.last_name.trim(),
              role: row.role as Role,
              school_id: schoolId,
              updated_at: new Date(),
            },
          });
          result.updated++;
        } else {
          // Create new user with a random password
          const tempPassword = this.generateTempPassword();
          const passwordHash = await bcrypt.hash(tempPassword, 12);

          await this.prisma.user.create({
            data: {
              email: row.email.toLowerCase().trim(),
              first_name: row.first_name.trim(),
              last_name: row.last_name.trim(),
              role: row.role as Role,
              school_id: schoolId,
              password_hash: passwordHash,
              is_active: true,
            },
          });
          result.added++;
        }
      } catch (error: any) {
        this.logger.error(
          `Bulk import row ${rowNum} failed: ${error.message}`,
          error.stack,
        );
        result.errors.push(
          `Row ${rowNum}: ${error.message || 'Unknown error'}`,
        );
      }
    }

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        actor_id: adminId,
        action: 'BULK_ROSTER_IMPORT',
        resource_type: 'School',
        resource_id: schoolId,
        metadata: {
          added: result.added,
          updated: result.updated,
          errorCount: result.errors.length,
        },
      },
    });

    this.logger.log(
      `Bulk import complete: ${result.added} added, ${result.updated} updated, ${result.errors.length} errors`,
    );

    return result;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private generateTempPassword(): string {
    const length = 12;
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }
}
