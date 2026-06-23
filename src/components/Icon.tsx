import React from "react";
import Svg, { Circle, Line, Path, Polyline, Polygon, Rect } from "react-native-svg";

/**
 * Iconițe SVG (stil Feather/MIT) — ZERO dependență de încărcarea unui font.
 * Randează garantat pe web, telefon și desktop. Înlocuiește @expo/vector-icons.
 * API compatibil: <Icon name="mic" size={20} color="#fff" />.
 */
export function Icon({ name, size = 24, color = "#000" }: { name: string; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const V = ({ children }: { children: React.ReactNode }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">{children}</Svg>
  );

  switch (name) {
    case "chevron-back":
      return <V><Polyline points="15 18 9 12 15 6" {...p} /></V>;
    case "arrow-back":
      return <V><Line x1="19" y1="12" x2="5" y2="12" {...p} /><Polyline points="12 19 5 12 12 5" {...p} /></V>;
    case "arrow-up":
      return <V><Line x1="12" y1="19" x2="12" y2="5" {...p} /><Polyline points="5 12 12 5 19 12" {...p} /></V>;
    case "send":
      return <V><Line x1="22" y1="2" x2="11" y2="13" {...p} /><Polygon points="22 2 15 22 11 13 2 9 22 2" {...p} /></V>;
    case "mic":
      return <V><Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" {...p} /><Path d="M19 10v2a7 7 0 0 1-14 0v-2" {...p} /><Line x1="12" y1="19" x2="12" y2="23" {...p} /><Line x1="8" y1="23" x2="16" y2="23" {...p} /></V>;
    case "stop":
      return <V><Rect x="6" y="6" width="12" height="12" rx="2" fill={color} /></V>;
    case "call":
    case "call-outline":
      return <V><Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" {...p} /></V>;
    case "videocam":
      return <V><Path d="M23 7l-7 5 7 5V7z" {...p} /><Rect x="1" y="5" width="15" height="14" rx="2" {...p} /></V>;
    case "ellipsis-vertical":
      return <V><Circle cx="12" cy="5" r="1.4" fill={color} /><Circle cx="12" cy="12" r="1.4" fill={color} /><Circle cx="12" cy="19" r="1.4" fill={color} /></V>;
    case "scan-outline":
      return <V>
        <Path d="M3 8V5a2 2 0 0 1 2-2h3" {...p} />
        <Path d="M16 3h3a2 2 0 0 1 2 2v3" {...p} />
        <Path d="M21 16v3a2 2 0 0 1-2 2h-3" {...p} />
        <Path d="M8 21H5a2 2 0 0 1-2-2v-3" {...p} />
      </V>;
    case "camera":
      return <V><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p} /><Circle cx="12" cy="13" r="4" {...p} /></V>;
    case "happy-outline":
      return <V><Circle cx="12" cy="12" r="10" {...p} /><Path d="M8 14s1.5 2 4 2 4-2 4-2" {...p} /><Line x1="9" y1="9" x2="9.01" y2="9" {...p} /><Line x1="15" y1="9" x2="15.01" y2="9" {...p} /></V>;
    case "keypad-outline":
    case "chatbox-ellipses-outline":
      return <V><Rect x="3" y="3" width="7" height="7" rx="1.5" {...p} /><Rect x="14" y="3" width="7" height="7" rx="1.5" {...p} /><Rect x="14" y="14" width="7" height="7" rx="1.5" {...p} /><Rect x="3" y="14" width="7" height="7" rx="1.5" {...p} /></V>;
    case "add-circle-outline":
      return <V><Circle cx="12" cy="12" r="10" {...p} /><Line x1="12" y1="8" x2="12" y2="16" {...p} /><Line x1="8" y1="12" x2="16" y2="12" {...p} /></V>;
    case "attach":
      return <V><Path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" {...p} /></V>;
    case "lock-closed":
      return <V><Rect x="3" y="11" width="18" height="11" rx="2" {...p} /><Path d="M7 11V7a5 5 0 0 1 10 0v4" {...p} /></V>;
    case "lock-open":
      return <V><Rect x="3" y="11" width="18" height="11" rx="2" {...p} /><Path d="M7 11V7a5 5 0 0 1 9.9-1" {...p} /></V>;
    case "trash-outline":
      return <V><Polyline points="3 6 5 6 21 6" {...p} /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...p} /><Line x1="10" y1="11" x2="10" y2="17" {...p} /><Line x1="14" y1="11" x2="14" y2="17" {...p} /></V>;
    case "ban-outline":
      return <V><Circle cx="12" cy="12" r="10" {...p} /><Line x1="4.93" y1="4.93" x2="19.07" y2="19.07" {...p} /></V>;
    case "add":
      return <V><Line x1="12" y1="5" x2="12" y2="19" {...p} /><Line x1="5" y1="12" x2="19" y2="12" {...p} /></V>;
    case "people":
      return <V><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" {...p} /><Circle cx="9" cy="7" r="4" {...p} /><Path d="M23 21v-2a4 4 0 0 0-3-3.87" {...p} /><Path d="M16 3.13a4 4 0 0 1 0 7.75" {...p} /></V>;
    case "chatbubbles":
      return <V><Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" {...p} /></V>;
    case "shield":
      return <V><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p} /></V>;
    case "settings":
      return <V><Circle cx="12" cy="12" r="3" {...p} /><Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p} /></V>;
    case "share-outline":
      return <V><Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" {...p} /><Polyline points="16 6 12 2 8 6" {...p} /><Line x1="12" y1="2" x2="12" y2="15" {...p} /></V>;
    case "create":
      return <V><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" {...p} /><Path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" {...p} /></V>;
    default:
      return <V><Circle cx="12" cy="12" r="9" {...p} /></V>;
  }
}
