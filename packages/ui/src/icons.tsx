import type { CSSProperties } from "react";

export interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
}

const base: CSSProperties = { display: "block", flexShrink: 0 };

/** Shared stroke defaults for the line-icon set — 1.75px, round joins, no fill. */
function Svg({
  size = 16,
  color = "currentColor",
  style,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ ...base, ...style }}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4.5v15l13-7.5z" fill={p.color ?? "currentColor"} stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill={p.color ?? "currentColor"} stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill={p.color ?? "currentColor"} stroke="none" />
  </Svg>
);

export const StepForwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 5v14l10-7z" fill={p.color ?? "currentColor"} stroke="none" />
    <rect x="17" y="5" width="2.4" height="14" rx="1" fill={p.color ?? "currentColor"} stroke="none" />
  </Svg>
);

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 7 4 11l4 4" />
    <path d="M4 11h11a5 5 0 0 1 0 10h-2" />
  </Svg>
);

export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m16 7 4 4-4 4" />
    <path d="M20 11H9a5 5 0 0 0 0 10h2" />
  </Svg>
);

export const ScopesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17V9M8 17V4M13 17v-7M18 17v-4" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.4" />
  </Svg>
);

export const FilmIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16M16 4v16M3 9h5M16 9h5M3 15h5M16 15h5" />
  </Svg>
);

export const CameraDeviceIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3Z" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5 10 17l9-11" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 1 3 6.7" />
    <path d="M3 20v-5h5" />
  </Svg>
);

export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11m0 0-4-4m4 4 4-4" />
    <path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />
  </Svg>
);
