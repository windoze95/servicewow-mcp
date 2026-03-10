import axios, { type AxiosInstance, type AxiosError } from "axios";
import { logger } from "../utils/logger.js";

export interface ServiceNowRequestOptions {
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

export interface ServiceNowApiError {
  statusCode: number;
  responseBody?: unknown;
  message: string;
}

export class ServiceNowClient {
  private client: AxiosInstance;

  constructor(
    private instanceUrl: string,
    private accessToken: string
  ) {
    this.client = axios.create({
      baseURL: instanceUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  async get<T = unknown>(
    path: string,
    options: ServiceNowRequestOptions = {}
  ): Promise<{ data: T; headers: Record<string, string> }> {
    const startTime = Date.now();
    try {
      const response = await this.client.get(path, {
        params: {
          sysparm_display_value: "true",
          ...options.params,
        },
        headers: options.headers,
      });

      logger.debug(
        {
          method: "GET",
          path,
          status: response.status,
          duration: Date.now() - startTime,
        },
        "ServiceNow API call"
      );

      return {
        data: response.data as T,
        headers: response.headers as Record<string, string>,
      };
    } catch (err) {
      throw this.mapError(err as AxiosError, "GET", path, startTime);
    }
  }

  async post<T = unknown>(
    path: string,
    body: unknown,
    options: ServiceNowRequestOptions = {}
  ): Promise<{ data: T; headers: Record<string, string> }> {
    const startTime = Date.now();
    try {
      const response = await this.client.post(path, body, {
        params: {
          sysparm_display_value: "true",
          ...options.params,
        },
        headers: options.headers,
      });

      logger.debug(
        {
          method: "POST",
          path,
          status: response.status,
          duration: Date.now() - startTime,
        },
        "ServiceNow API call"
      );

      return {
        data: response.data as T,
        headers: response.headers as Record<string, string>,
      };
    } catch (err) {
      throw this.mapError(err as AxiosError, "POST", path, startTime);
    }
  }

  async patch<T = unknown>(
    path: string,
    body: unknown,
    options: ServiceNowRequestOptions = {}
  ): Promise<{ data: T; headers: Record<string, string> }> {
    const startTime = Date.now();
    try {
      const response = await this.client.patch(path, body, {
        params: {
          sysparm_display_value: "true",
          ...options.params,
        },
        headers: options.headers,
      });

      logger.debug(
        {
          method: "PATCH",
          path,
          status: response.status,
          duration: Date.now() - startTime,
        },
        "ServiceNow API call"
      );

      return {
        data: response.data as T,
        headers: response.headers as Record<string, string>,
      };
    } catch (err) {
      throw this.mapError(err as AxiosError, "PATCH", path, startTime);
    }
  }

  private mapError(
    err: AxiosError,
    method: string,
    path: string,
    startTime: number
  ): ServiceNowApiError {
    const statusCode = err.response?.status || 500;
    const responseBody = err.response?.data;

    logger.error(
      {
        method,
        path,
        statusCode,
        duration: Date.now() - startTime,
        responseBody,
      },
      "ServiceNow API error"
    );

    const messages: Record<number, string> = {
      401: "Authentication expired",
      403: "Insufficient permissions",
      404: "Record not found",
      429: "Rate limited by ServiceNow",
    };

    return {
      statusCode,
      responseBody,
      message:
        messages[statusCode] ||
        (statusCode >= 500
          ? "ServiceNow unavailable"
          : `ServiceNow API error (${statusCode})`),
    };
  }
}
