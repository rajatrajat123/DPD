import { config } from '../../config/env';
import { secureStorage } from '../storage/secureStore';
import { ApiErrorEnvelope } from '../../types';

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  fields?: Record<string, string>;
  override cause?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    fields?: Record<string, string>,
    cause?: unknown
  ) {
    super(message);

    // Maintain prototype chain for instanceof checks across runtimes
    Object.setPrototypeOf(this, new.target.prototype);

    // In React Native Hermes engine, Error.prototype.name has only a getter without a setter.
    // Direct assignment (this.name = 'ApiError') throws:
    // "TypeError: Cannot assign to property 'name' which has only a getter".
    // Using Object.defineProperty safely defines 'name' directly on the instance.
    Object.defineProperty(this, 'name', {
      value: 'ApiError',
      writable: true,
      enumerable: false,
      configurable: true,
    });

    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }

  override get name(): string {
    return 'ApiError';
  }
}

function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
}

let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

function onRefreshed(token: string | null) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string | null) => void) {
  refreshSubscribers.push(cb);
}

async function refreshTokenAndRetry<T>(retryFn: () => Promise<T>): Promise<T> {
  if (isRefreshing) {
    return new Promise<T>((resolve, reject) => {
      addRefreshSubscriber((newToken) => {
        if (newToken) {
          resolve(retryFn());
        } else {
          reject(new ApiError(401, 'UNAUTHENTICATED', 'Session expired'));
        }
      });
    });
  }

  isRefreshing = true;
  const refreshToken = await secureStorage.getRefreshToken();

  if (refreshToken) {
    try {
      const refreshRes = await fetch(`${config.apiUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': generateRequestId(),
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as { access_token: string; refresh_token?: string };
        await secureStorage.saveTokens(data.access_token, data.refresh_token || refreshToken);
        isRefreshing = false;
        onRefreshed(data.access_token);
        return retryFn();
      }
    } catch {
      // Refresh failed
    }
  }

  // Refresh failed or no refresh token
  isRefreshing = false;
  await secureStorage.clearTokens();
  onRefreshed(null);
  throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired. Please log in again.');
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${config.apiUrl}${endpoint}`;
  const requestId = generateRequestId();

  const headers = new Headers(options.headers || {});
  headers.set('X-Request-ID', requestId);
  headers.set('Accept', 'application/json');

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Attach access token if present
  const accessToken = await secureStorage.getAccessToken();
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.apiTimeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 401 Unauthorized handling with token rotation
    if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
      return refreshTokenAndRetry(() => apiClient<T>(endpoint, options, true));
    }

    if (!response.ok) {
      let errorData: ApiErrorEnvelope | null = null;
      try {
        errorData = (await response.json()) as ApiErrorEnvelope;
      } catch {
        // Not JSON
      }

      const code = errorData?.error?.code || `HTTP_${response.status}`;
      const message = errorData?.error?.message || response.statusText || 'An unexpected error occurred';
      const reqId = errorData?.error?.request_id || requestId;
      const fields = errorData?.error?.fields;

      throw new ApiError(response.status, code, message, reqId, fields);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof ApiError) {
      throw error;
    }
    const errorObj = error && typeof error === 'object' ? (error as { name?: string; message?: string }) : null;
    const msg = error instanceof Error ? error.message : errorObj?.message || 'Network connection failure';
    const isAbort = errorObj?.name === 'AbortError' || /canceled|aborted/i.test(msg);
    if (isAbort) {
      throw new ApiError(408, 'TIMEOUT', `Request timed out or was canceled (${config.apiUrl}). Please check server connectivity.`, requestId, undefined, error);
    }
    throw new ApiError(0, 'NETWORK_ERROR', `${msg} (${config.apiUrl})`, requestId, undefined, error);
  }
}

/**
 * Uploads multipart FormData.
 * In React Native runtimes, uses native XMLHttpRequest (RCTNetworking) to support
 * file URIs ({ uri, name, type }) without triggering Expo WinterCG fetch's
 * "Unsupported FormDataPart implementation" exception.
 * In environments without XMLHttpRequest (e.g. Node tests), falls back to apiClient fetch.
 */
export async function postFormData<T>(
  endpoint: string,
  formData: FormData,
  customHeaders?: Record<string, string>,
  isRetry = false
): Promise<T> {
  if (typeof XMLHttpRequest === 'undefined') {
    return apiClient<T>(
      endpoint,
      {
        method: 'POST',
        headers: customHeaders,
        body: formData,
      },
      isRetry
    );
  }

  const url = endpoint.startsWith('http') ? endpoint : `${config.apiUrl}${endpoint}`;
  const requestId = customHeaders?.['X-Request-ID'] || generateRequestId();
  const accessToken = await secureStorage.getAccessToken();

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.timeout = config.apiTimeoutMs;

    xhr.setRequestHeader('X-Request-ID', requestId);
    xhr.setRequestHeader('Accept', 'application/json');

    if (accessToken && !customHeaders?.['Authorization']) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    if (customHeaders) {
      for (const [key, val] of Object.entries(customHeaders)) {
        // Do NOT set Content-Type header so the runtime generates the multipart boundary
        if (key.toLowerCase() !== 'content-type' && val !== undefined) {
          xhr.setRequestHeader(key, val);
        }
      }
    }

    xhr.onload = async () => {
      // 401 Unauthorized handling with token rotation
      if (xhr.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
        try {
          const retried = await refreshTokenAndRetry(() =>
            postFormData<T>(endpoint, formData, customHeaders, true)
          );
          resolve(retried);
        } catch (refreshErr) {
          reject(refreshErr);
        }
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204 || !xhr.responseText) {
          resolve({} as T);
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText) as T;
          resolve(data);
        } catch {
          reject(new ApiError(xhr.status, 'INVALID_JSON', 'Malformed response from server', requestId));
        }
        return;
      }

      let errorData: ApiErrorEnvelope | null = null;
      try {
        errorData = JSON.parse(xhr.responseText) as ApiErrorEnvelope;
      } catch {
        // Not JSON
      }

      const code = errorData?.error?.code || `HTTP_${xhr.status}`;
      const message = errorData?.error?.message || xhr.statusText || 'An unexpected error occurred';
      const reqId = errorData?.error?.request_id || requestId;
      const fields = errorData?.error?.fields;

      reject(new ApiError(xhr.status, code, message, reqId, fields));
    };

    xhr.onerror = () => {
      reject(new ApiError(0, 'NETWORK_ERROR', 'Network connection failure', requestId));
    };

    xhr.ontimeout = () => {
      reject(new ApiError(408, 'TIMEOUT', 'Request timed out. Please check your connection.', requestId));
    };

    xhr.onabort = () => {
      reject(new ApiError(0, 'ABORTED', 'Request was aborted.', requestId));
    };

    try {
      xhr.send(formData);
    } catch (sendErr: unknown) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      reject(new ApiError(0, 'NETWORK_ERROR', msg, requestId, undefined, sendErr));
    }
  });
}

export const api = {
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = path;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) searchParams.append(k, String(v));
      });
      const qs = searchParams.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    return apiClient<T>(url, { method: 'GET' });
  },

  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return apiClient<T>(path, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  postFormData<T>(path: string, formData: FormData, headers?: Record<string, string>): Promise<T> {
    return postFormData<T>(path, formData, headers);
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return apiClient<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<T> {
    return apiClient<T>(path, { method: 'DELETE' });
  },
};
