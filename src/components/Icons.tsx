import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const InfinityIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 12c-2-2.6-3.6-4-5.4-4a4 4 0 1 0 0 8c1.8 0 3.4-1.4 5.4-4Zm0 0c2 2.6 3.6 4 5.4 4a4 4 0 1 0 0-8c-1.8 0-3.4 1.4-5.4 4Z" />
  </Svg>
)

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
)

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
)

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Svg>
)

export const ArrowUpRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15" />
  </Svg>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </Svg>
)

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Svg>
)

export const HeartIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
)

export const StarIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="m12 3.2 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6L3.3 9.5l6.1-.7L12 3.2Z" />
  </Svg>
)

export const BookmarkIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M7 3.5h10a1 1 0 0 1 1 1v15.2a.5.5 0 0 1-.8.4L12 16.3l-5.2 3.8a.5.5 0 0 1-.8-.4V4.5a1 1 0 0 1 1-1Z" />
  </Svg>
)

export const MicIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </Svg>
)

export const PaperclipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m19 11.5-6.7 6.7a4.6 4.6 0 0 1-6.5-6.5l7.2-7.2a3 3 0 0 1 4.3 4.3l-7 7a1.5 1.5 0 0 1-2.1-2.1l6.3-6.3" />
  </Svg>
)

export const ChatIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M6 4.5h12a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 17.5h-6.2l-4.3 3.2a.6.6 0 0 1-1-.5v-2.7H6A2.5 2.5 0 0 1 3.5 15V7A2.5 2.5 0 0 1 6 4.5Z" />
  </Svg>
)

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4.5" width="14" height="6" rx="2" />
    <rect x="5" y="13.5" width="14" height="6" rx="2" />
  </Svg>
)

export const CardsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="11" height="14" rx="2.5" />
    <path d="M18 7v10M21 9v6" />
  </Svg>
)

export const CapIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z" />
    <path d="M6.5 11.5v4.2c0 1.3 2.5 2.8 5.5 2.8s5.5-1.5 5.5-2.8v-4.2M21.5 9.5v5" />
  </Svg>
)

export const DumbbellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 7.5v9M4.5 9.5v5M17 7.5v9M19.5 9.5v5M7 12h10" />
  </Svg>
)

export const BriefcaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="7.5" width="16" height="12" rx="2.5" />
    <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M4 12.5h16" />
  </Svg>
)

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
)

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z" />
  </Svg>
)

export const SparkIcon = (p: IconProps) => (
  <Svg {...p} stroke="none" fill="currentColor">
    <path d="M12 3c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z" />
  </Svg>
)

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
)

export const WaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" />
  </Svg>
)

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14" rx="3" />
    <path d="M8 3.5v4M16 3.5v4M4 10h16" />
  </Svg>
)

export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
)

export const PhoneDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 13.2c4.8-4.3 12.2-4.3 17 0 .6.6.6 1.5 0 2.1l-1.6 1.5c-.5.5-1.3.5-1.8.1l-1.9-1.5c-.4-.3-.6-.8-.5-1.3l.2-1.4a10.6 10.6 0 0 0-6.8 0l.2 1.4c.1.5-.1 1-.5 1.3l-1.9 1.5c-.5.4-1.3.4-1.8-.1l-1.6-1.5c-.6-.6-.6-1.5 0-2.1Z" />
  </Svg>
)

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.6c1.6.6 2.6 2 3 4.4" />
  </Svg>
)

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9 18.5l-4.5 1Z" />
  </Svg>
)

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9.5 6V4.5h5V6.5M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13M10 10.5v6M14 10.5v6" />
  </Svg>
)

export const StopIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="3" fill="currentColor" stroke="none" />
  </Svg>
)

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9M17.9 3.6v3.6h-3.6M6.1 20.4v-3.6h3.6" />
  </Svg>
)

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
  </Svg>
)

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
)

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)

export const BADGE_ICON = {
  sleep: MoonIcon,
  routine: SparkIcon,
  work: BriefcaseIcon,
  food: StarIcon,
  sport: DumbbellIcon,
  read: BookmarkIcon,
} as const
