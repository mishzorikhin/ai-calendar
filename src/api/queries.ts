import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Booking, CalendarEvent, ChatMessage, NewBooking, NewEvent } from '../domain/types'
import { toISODate } from '../lib/dates'
import { useApi } from './provider'

/** Ключи кэша — в одном месте, чтобы инвалидация не расходилась с запросами. */
export const keys = {
  events: (date: Date) => ['events', toISODate(date)] as const,
  allEvents: ['events'] as const,
  month: (year: number, month: number) => ['month', year, month] as const,
  allMonths: ['month'] as const,
  places: ['places'] as const,
  reviews: (placeId: string) => ['reviews', placeId] as const,
  bookings: ['bookings'] as const,
  messages: ['messages'] as const,
}

const NO_EVENTS: CalendarEvent[] = []

/** События дня. Пока грузятся — предыдущий день (без мигания при листании) или пустой список. */
export function useDayEvents(date: Date) {
  const api = useApi()
  const query = useQuery({
    queryKey: keys.events(date),
    queryFn: () => api.getEvents(date),
    placeholderData: keepPreviousData,
  })
  return { ...query, events: query.data ?? NO_EVENTS }
}

export function useMonthDots(year: number, month: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.month(year, month), queryFn: () => api.getMonthDots(year, month) })
}

export function usePlaces() {
  const api = useApi()
  return useQuery({ queryKey: keys.places, queryFn: () => api.getPlaces(), staleTime: Infinity })
}

export function useReviews(placeId: string) {
  const api = useApi()
  return useQuery({ queryKey: keys.reviews(placeId), queryFn: () => api.getReviews(placeId), staleTime: Infinity })
}

export function useBookings() {
  const api = useApi()
  return useQuery({ queryKey: keys.bookings, queryFn: () => api.getBookings() })
}

/** Ближайшая активная бронь — для «Скоро» и списка задач. */
export function useActiveBooking(): Booking | null {
  const { data } = useBookings()
  return data?.find((b) => b.status === 'confirmed') ?? null
}

export function useCreateEvent() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewEvent) => api.createEvent(input),
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: keys.events(event.date) })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
}

function useInvalidateBookings() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: keys.bookings })
    void qc.invalidateQueries({ queryKey: keys.allEvents })
    void qc.invalidateQueries({ queryKey: keys.allMonths })
  }
}

export function useCreateBooking() {
  const api = useApi()
  const invalidate = useInvalidateBookings()
  return useMutation({ mutationFn: (input: NewBooking) => api.createBooking(input), onSuccess: invalidate })
}

export function useCancelBooking() {
  const api = useApi()
  const invalidate = useInvalidateBookings()
  return useMutation({ mutationFn: (id: string) => api.cancelBooking(id), onSuccess: invalidate })
}

const NO_MESSAGES: ChatMessage[] = []

export function useMessages() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.messages, queryFn: () => api.getMessages() })
  return query.data ?? NO_MESSAGES
}

/** Сообщение сразу появляется в чате (оптимистично), затем заменяется ответом сервера. */
export function useAddMessage() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, text }: Pick<ChatMessage, 'role' | 'text'>) => api.addMessage(role, text),
    onMutate: async ({ role, text }) => {
      await qc.cancelQueries({ queryKey: keys.messages })
      const previous = qc.getQueryData<ChatMessage[]>(keys.messages)
      qc.setQueryData<ChatMessage[]>(keys.messages, (list = []) => [
        ...list,
        { id: (list.at(-1)?.id ?? 0) + 1, role, text },
      ])
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.messages, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.messages }),
  })
}
