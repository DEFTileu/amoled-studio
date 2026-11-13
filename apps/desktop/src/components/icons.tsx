import type { ReactNode } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
const mk = (body: ReactNode, solid = false) => ({ size = 16, rot = 0 }: { size?: number; rot?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: 'none', transform: rot ? `rotate(${rot}deg)` : undefined }} {...(solid ? { fill: 'currentColor' } : S)}>{body}</svg>
);

export const IconSidebar = mk(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>);
export const IconInspector = mk(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /></>);
export const IconPlay = mk(<polygon points="6 3 20 12 6 21 6 3" />, true);
export const IconStop = mk(<rect x="5" y="5" width="14" height="14" rx="1" />, true);
export const IconRestart = mk(<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>);
export const IconCamera = mk(<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></>);
export const IconSun = mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconFolder = mk(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
export const IconMonitor = mk(<><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8M12 17v4" /></>);
export const IconChip = mk(<><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>);
export const IconFile = mk(<><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><path d="M14 2v6h6" /></>);
export const IconSliders = mk(<><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IconCog = mk(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>);
export const IconClose = mk(<path d="M18 6 6 18M6 6l12 12" />);
export const IconChevron = mk(<path d="m6 15 6-6 6 6" />);
