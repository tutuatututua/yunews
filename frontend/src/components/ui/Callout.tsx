import React from 'react'
import { cn } from '../../lib/cn'
import { ui, util } from '../../styles'
import styles from './Callout.module.css'

export function ErrorCallout(props: { title?: string; message: string; onDismiss?: () => void }) {
  const { title = 'Something went wrong', message, onDismiss } = props
  return (
    <div className={styles.alert} role="alert">
      <div className={styles.alertTitle}>{title}</div>
      <div className={styles.alertBody}>{message}</div>
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
