import { useState, useEffect } from 'react'
import type { LayerData } from '../logic/ImportLoaders'

export function NumericInput({ label, value, onChange }: { label: string, value: number, onChange: (val: number) => void }) {
  const [local, setLocal] = useState(value.toFixed(2));
  useEffect(() => setLocal(value.toFixed(2)), [value]);
  const commit = () => { const p = parseFloat(local); if (!isNaN(p)) onChange(p); else setLocal(value.toFixed(2)); };
  return <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>{label}<input type="text" value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }} /></label>;
}

export function LayerItem({ layer, onToggle, onDelete }: { layer: LayerData, onToggle: () => void, onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '4px' }}>
      <div style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={layer.name}>{layer.name}</div>
      <button onClick={onToggle}>{layer.visible ? '👁️' : '🕶️'}</button>
      <button onClick={onDelete}>🗑️</button>
    </div>
  );
}
