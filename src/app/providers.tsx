import type { ReactNode } from 'react'
import { AssistantProvider } from './assistant'
import { BarProvider } from './bar'
import { CalendarProvider } from './calendar'
import { ComposerProvider } from './composer'
import { NavigationProvider } from './navigation'
import { UndoProvider } from './undo'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <NavigationProvider>
      <CalendarProvider>
        <AssistantProvider>
          <ComposerProvider>
            <BarProvider>
              <UndoProvider>{children}</UndoProvider>
            </BarProvider>
          </ComposerProvider>
        </AssistantProvider>
      </CalendarProvider>
    </NavigationProvider>
  )
}
