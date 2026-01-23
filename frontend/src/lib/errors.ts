import { ApiRequestError } from '../services/api'

export type UiErrorInfo = {
  message: string
  requestId?: string
  status?: number
}

export function getUiErrorInfo(err: unknown): UiErrorInfo | null {
  if (!err) return null

  if (err instanceof ApiRequestError) {
    return {
      message: err.message,
      requestId: err.requestId,
      status: err.status,
    }
  }

  if (err instanceof Error) {
    return { message: err.message }
  }

  try {
    const s = String(err)
    return s ? { message: s } : null
  } catch {
    return null
  }
}
