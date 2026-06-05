const ICONS = {
  // navigation
  'chevron-down':  'M4 6l4 4 4-4',
  'chevron-right': 'M6 4l4 4-4 4',
  'chevron-left':  'M10 4l-4 4 4 4',
  'chevron-up':    'M4 10l4-4 4 4',
  'arrow-right':   'M3 8h10M9 4l4 4-4 4',
  'arrow-left':    'M13 8H3M7 4L3 8l4 4',
  // actions
  plus:            'M8 3v10M3 8h10',
  minus:           'M3 8h10',
  x:               'M4 4l8 8M12 4l-8 8',
  check:           'M3 8l3 3 7-7',
  search:          'M11.5 11.5L14 14M7 12a5 5 0 110-10 5 5 0 010 10z',
  // tools
  'text':          'M3 4h10M8 4v9',
  'shape':         'M3 3h10v10H3z',
  'circle':        'M8 14A6 6 0 108 2a6 6 0 000 12z',
  'line':          'M3 13L13 3',
  'triangle':      'M8 3l6 10H2z',
  'diamond':       'M8 2l6 6-6 6-6-6z',
  'hexagon':       'M5 3h6l3 5-3 5H5L2 8z',
  'rounded-rect':  'M5 3h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
  'arrow-shape':   'M2 8h9M8 4l4 4-4 4',
  'pentagon':      'M8 2l6 4.5-2.3 7H4.3L2 6.5z',
  'image':         'M2 3h12v10H2zM2 11l3-3 2 2 4-4 3 3',
  'pen':           'M3 13L10.5 5.5 12.5 7.5 5 15H3v-2zM10.5 5.5L12 4l2 2-1.5 1.5z',
  'grid':          'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  'table':         'M2 3h12v10H2zM2 7h12M2 11h12M7 3v10',
  'list':          'M3 4h10M3 8h10M3 12h10',
  'sidebar':       'M2 3h12v10H2zM6 3v10',
  // file
  'folder':        'M2 4h4l2 2h6v7H2z',
  'document':      'M3 2h7l3 3v9H3zM10 2v3h3',
  // misc
  'star':          'M8 2l1.7 3.5L13.5 6 10.8 8.6 11.5 12.5 8 10.7 4.5 12.5 5.2 8.6 2.5 6 6.3 5.5z',
  'bolt':          'M9 2L3 10h4l-1 5 6-8H8l1-5z',
  'sparkle':       'M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2',
  'play':          'M4 3v11l9-5.5z',
  'pause':         'M4 3h3v10H4zM9 3h3v10H9z',
  'stop':          'M3 3h10v10H3z',
  'skip-back':     'M3 3v10M13 3L5 8l8 5z',
  'skip-forward':  'M13 3v10M3 3l8 5-8 5z',
  // layout
  'layers':        'M8 1l7 4-7 4-7-4zM1 9l7 4 7-4M1 12l7 4 7-4',
  'columns':       'M2 2h5v12H2zM9 2h5v12H9z',
  'rows':          'M2 2h12v5H2zM2 9h12v5H2z',
  // state
  'lock':          'M4 7V5a4 4 0 018 0v2M3 7h10v7H3z',
  'eye':           'M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5zM8 11a3 3 0 100-6 3 3 0 000 6z',
  'eye-off':       'M2 2l12 12M6 6a3 3 0 004 4M9.5 5.5a3 3 0 013 3M4.3 4.3C2.5 5.5 1 8 1 8s3 5 7 5c1.1 0 2-.3 2.9-.7M11.5 11.5C13.2 10.5 15 8 15 8s-3-5-7-5c-.7 0-1.4.1-2 .3',
  // comms
  'message':       'M2 3h12v9H6l-3 3V3z',
  'share':         'M11 3l3 3-3 3M14 6H8a5 5 0 00-5 5v2',
  'copy':          'M5 2h7v9H5zM3 5v9h7',
  'trash':         'M3 5h10M5 5V3h6v2M5 5v8h6V5',
  // stats
  'chart-up':      'M2 13h12M3 11l3-3 3 2 4-5',
  'chart-bar':     'M2 13h12M4 13V7M8 13V4M12 13V10',
  // user
  'user':          'M8 8a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0',
  // misc 2
  'palette':       'M8 2a6 6 0 106 6c0-1-1-2-3-2s-1-2-1-2a2 2 0 00-2-2zM4 7a1 1 0 100-2 1 1 0 000 2zM8 5a1 1 0 100-2 1 1 0 000 2zM12 7a1 1 0 100-2 1 1 0 000 2z',
  'sun':           'M8 3v1M8 12v1M3 8H2M14 8h-1M4.2 4.2l.7.7M11.1 11.1l.7.7M11.8 4.2l-.7.7M4.9 11.1l-.7.7M8 11a3 3 0 110-6 3 3 0 010 6z',
  'moon':          'M13 9A5 5 0 117 3a4 4 0 006 6z',
  'comment-dot':   'M3 3h10v8H7l-3 3v-3H3z',
  'history':       'M2 8a6 6 0 106-6 6 6 0 00-6 6zM2 2v3h3M8 5v3l2 2',
  'settings':      'M8 5v1M8 10v1M5 8h1M10 8h1M5.8 5.8l.7.7M9.5 9.5l.7.7M10.2 5.8l-.7.7M6.5 9.5l-.7.7M8 10a2 2 0 100-4 2 2 0 000 4z',
  'flag':          'M3 2v12M3 2h9l-2 3 2 3H3',
  'link':          'M6 10a3 3 0 01.9-2.1l2-2a3 3 0 014.2 4.2l-.8.8M10 6a3 3 0 01-.9 2.1l-2 2a3 3 0 01-4.2-4.2l.8-.8',
  'download':      'M8 2v9M4 7l4 4 4-4M2 14h12',
  'upload':        'M8 14V5M4 9l4-4 4 4M2 2h12',
  'refresh':       'M2 8a6 6 0 0110-4M14 8a6 6 0 01-10 4M12 2v4h-4M4 14v-4h4',
  'bold':          'M4 3h5a3 3 0 010 6H4zM4 9h6a3 3 0 010 6H4z',
  'italic':        'M10 3H7M9 13H6M10 3l-3 10',
  'underline':     'M4 3v6a4 4 0 008 0V3M3 14h10',
  'align-left':    'M2 3h12M2 7h8M2 11h12M2 15h8',
  'align-center':  'M2 3h12M4 7h8M2 11h12M4 15h8',
  'align-right':   'M2 3h12M6 7h8M2 11h12M6 15h8',
  'move':          'M8 2v12M2 8h12M5 5l-3 3 3 3M11 5l3 3-3 3M5 5l3-3 3 3M5 11l3 3 3-3',
  'zoom-in':       'M7 3a4 4 0 110 8 4 4 0 010-8zM10 10l4 4M5 7h4M7 5v4',
  'zoom-out':      'M7 3a4 4 0 110 8 4 4 0 010-8zM10 10l4 4M5 7h4',
  'expand':        'M3 7V3h4M13 7V3h-4M3 9v4h4M13 9v4h-4',
  'key':           'M11 6a3 3 0 10-5.8 1L2 10v3h3v-2h2v-2l1.2-1.2A3 3 0 0011 6zM11 5.5h.01',
  'dot':           'M8 9a1 1 0 100-2 1 1 0 000 2z',
  'menu':          'M2 4h12M2 8h12M2 12h12',
  'more-h':        'M4 8h.01M8 8h.01M12 8h.01',
  'more-v':        'M8 4h.01M8 8h.01M8 12h.01',
  'filter':        'M2 3h12l-4.5 6v5L6 15V9z',
  'sort':          'M4 3v10M2 11l2 2 2-2M12 13V3M10 5l2-2 2 2',
  'magic':         'M3 13L11 5M11 5l1-1M11 5l-1-1M11 5l-1 1M11 5l1 1M14 7h1M14 7h-1M14 7v1M14 7V6',
  'template':      'M2 2h12v4H2zM2 8h5v6H2zM9 8h5v6H9z',
  'presentation':  'M2 3h12v9H2zM6 15h4M8 12v3',
  'outline':       'M3 4h10M5 8h8M7 12h6',
  'aspect':        'M2 3h12v10H2zM2 3l12 10',
  'logic':         'M3 4v8M7 3v10M11 5v6',
  'ai':            'M8 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM13 9l.5 1.5L15 11l-1.5.5L13 13l-.5-1.5L11 11l1.5-.5z',
  'cursor':        'M3 3l4 11 2-5 5-2z',
  'component':     'M8 2l3 3-3 3-3-3zM14 8l-3 3-3-3 3-3zM8 14l-3-3 3-3 3 3zM2 8l3-3 3 3-3 3z',
  'timeline':      'M2 8h12M4 8V5M8 8V4M12 8V6',
  'frame':         'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
};

export default function Icon({ name, size = 14, style, className, strokeWidth = 1.5 }) {
  const d = ICONS[name];
  if (!d) return <span style={{ color: 'red', fontSize: 10 }}>?{name}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
         className={className} style={style} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
