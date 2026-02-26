import { ChatPanel } from '../components/chat/ChatPanel'
import styles from './ChatPage.module.css'

export default function ChatPage() {
  return (
    <div className={styles.page}>
      <div className={styles.panelWrap}>
        <ChatPanel />
      </div>
    </div>
  )
}
