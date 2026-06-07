export default function LaserPointer({ enabled }) {
  if (!enabled) return null;
  return (
    <div style={{
      position: 'absolute', left: '48%', top: '54%',
      width: 20, height: 20, borderRadius: '50%',
      background: 'oklch(0.7 0.25 25)',
      boxShadow: '0 0 30px oklch(0.7 0.25 25 / 0.6)',
    }}/>
  );
}
