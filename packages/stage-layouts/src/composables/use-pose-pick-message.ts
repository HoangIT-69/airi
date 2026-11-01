import type { MaybeRefOrGetter } from 'vue'

import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { storeToRefs } from 'pinia'
import { toValue } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Handler for the pose picker in the web composers.
 * The stage already plays the picked pose. The chat message lets the character answer it, as on desktop.
 */
export function usePosePickMessage(options: { sending: MaybeRefOrGetter<boolean> }) {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const { activeSessionId } = storeToRefs(useChatSessionStore())

  return function sendPosePickMessage(entry: { name: string }) {
    if (toValue(options.sending))
      return
    void chatStore.send({
      sessionId: activeSessionId.value,
      text: t('settings.pages.modules.motion.picker.message', { name: entry.name }),
    })
  }
}
