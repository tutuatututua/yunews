import React from 'react'
import { cn } from '../../lib/cn'
import { ui, util } from '../../styles'
import styles from './Callout.module.css'

export function ErrorCallout(props: {
  title?: string
  message: string
  requestId?: string
  details?: string
  onDismiss?: () => void
}) {
  const { title = 'Something went wrong', message, requestId, details, onDismiss } = props
  return (
    <div className={styles.alert} role="alert">
      <div className={styles.alertTitle}>{title}</div>
      <div className={styles.alertBody}>{message}</div>

      {(requestId || details) && (
        <details className={cn(util.small)} style={{ marginTop: 10 }}>
          <summary className={cn(util.muted)} style={{ cursor: 'pointer' }}>
            Details
          </summary>
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            {requestId ? (
              <div className={cn(util.muted, util.small)}>
                Request id: <span className={cn(util.preWrap)}>{requestId}</span>
              </div>
            ) : null}

            {details ? <pre>{details}</pre> : null}

            {requestId && (
              <button
                className={cn(ui.button, ui.ghost)}
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(requestId)
                }}
                aria-label="Copy request id"
              >
                Copy request id
              </button>
            )}
          </div>
        </details>
      )}

      {onDismiss && (
        <button className={cn(ui.button, ui.ghost)} onClick={onDismiss} aria-label="Dismiss error" type="button">
          Dismiss
        </button>
      )}
    </div>
  )
}

export function EmptyState(props: { title: string; body?: string }) {
  return (
    <div className={styles.emptyState} role="status" aria-live="polite">
      <div className={styles.emptyTitle}>{props.title}</div>
      {props.body ? <div className={cn(util.muted, util.small)}>{props.body}</div> : null}
    </div>
  )
}
