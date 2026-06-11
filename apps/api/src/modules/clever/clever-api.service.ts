import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';

const CLEVER_API_BASE = 'https://api.clever.com/v3.0';

export interface CleverProfile {
  id: string;
  email: string;
  name: { first: string; last: string };
  type: 'teacher' | 'student' | 'district_admin';
  school?: string;
  student_number?: string;
}

export interface CleverSection {
  id: string;
  name: string;
  grade: string;
  subject: string;
  teacher: string;
  students: string[];
}

export class CleverApiException extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public cleverId?: string,
  ) {
    super(message);
    this.name = 'CleverApiException';
  }
}

@Injectable()
export class CleverApiService {
  private readonly logger = new Logger(CleverApiService.name);
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: CLEVER_API_BASE,
      timeout: 30000,
    });
  }

  /**
   * Retry wrapper with exponential backoff for 429 Too Many Requests
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 5000,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        if (status === 429 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt); // 5s, 10s, 20s
          this.logger.warn(
            `Clever API rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error or max retries reached
        throw error;
      }
    }
    throw new Error('withRetry: unreachable code');
  }

  /**
   * Get user profile from Clever API using OAuth access token
   */
  async getProfile(accessToken: string): Promise<CleverProfile> {
    try {
      const response = await this.withRetry(async () =>
        this.client.get('/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );

      const data = response.data?.data;
      if (!data) {
        throw new CleverApiException('Invalid response from Clever API');
      }

      return {
        id: data.id,
        email: data.email,
        name: {
          first: data.name?.first || '',
          last: data.name?.last || '',
        },
        type: data.type,
        school: data.school,
        student_number: data.student_number,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Clever profile', error);
      const axiosError = error as AxiosError;
      throw new CleverApiException(
        'Failed to fetch user profile from Clever',
        axiosError.response?.status,
      );
    }
  }

  /**
   * Fetch all teachers for a school with pagination
   */
  async getTeachersForSchool(
    districtToken: string,
    cleverSchoolId: string,
  ): Promise<CleverProfile[]> {
    return this.paginateResource<CleverProfile>(
      `/schools/${cleverSchoolId}/users`,
      districtToken,
      { role: 'teacher' },
    );
  }

  /**
   * Fetch all students for a school with pagination
   */
  async getStudentsForSchool(
    districtToken: string,
    cleverSchoolId: string,
  ): Promise<CleverProfile[]> {
    return this.paginateResource<CleverProfile>(
      `/schools/${cleverSchoolId}/users`,
      districtToken,
      { role: 'student' },
    );
  }

  /**
   * Fetch all sections for a school with pagination
   */
  async getSectionsForSchool(
    districtToken: string,
    cleverSchoolId: string,
  ): Promise<CleverSection[]> {
    return this.paginateResource<CleverSection>(
      `/schools/${cleverSchoolId}/sections`,
      districtToken,
    );
  }

  /**
   * Generic pagination helper for Clever API
   */
  private async paginateResource<T>(
    endpoint: string,
    token: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    let nextPageUrl: string | null = endpoint;

    try {
      while (nextPageUrl) {
        const response = await this.withRetry(async () =>
          this.client.get(nextPageUrl!, {
            headers: { Authorization: `Bearer ${token}` },
            params: nextPageUrl === endpoint ? params : undefined,
          }),
        );

        const data = response.data?.data;
        if (Array.isArray(data)) {
          results.push(...data);
        }

        // Check for next page
        const links = response.data?.links;
        nextPageUrl = links?.find((link: any) => link.rel === 'next')?.uri || null;
      }

      this.logger.log(`Fetched ${results.length} records from ${endpoint}`);
      return results;
    } catch (error) {
      this.logger.error(`Failed to paginate ${endpoint}`, error);
      const axiosError = error as AxiosError;
      throw new CleverApiException(
        `Failed to fetch data from Clever: ${endpoint}`,
        axiosError.response?.status,
      );
    }
  }
}
