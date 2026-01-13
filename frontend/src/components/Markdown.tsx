import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

/**
 * Safe markdown renderer for model-generated content.
 * We deliberately do NOT enable raw HTML.
 */
export default React.memo(function Markdown(props: { markdown: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.markdown || ''}</ReactMarkdown>
    </div>
  )
})
