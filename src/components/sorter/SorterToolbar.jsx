import Icon from '../ui/Icon.jsx';
import { Button } from '../ui/Primitives.jsx';

export default function SorterToolbar({ mode, setMode, onBack, onAddSection, onRearrange, rearranging, rearrangeError }) {
  return (
    <div className="toolbar">
      <div className="group">
        <Button variant="ghost" icon="chevron-left" onClick={onBack}>Editor</Button>
      </div>
      <div className="group">
        <div className="seg" style={{ width: 220 }}>
          <button className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}>
            <Icon name="grid" size={12}/> Grid
          </button>
          <button className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}>
            <Icon name="outline" size={12}/> Outline
          </button>
        </div>
      </div>
      <div className="group">
        <Button variant="ghost" icon="filter">All sections</Button>
        <Button variant="ghost" icon="sort">By order</Button>
      </div>
      <div className="spacer"/>
      <div className="group" style={{ border: 0 }}>
        {onAddSection && <Button variant="ghost" icon="plus" onClick={onAddSection}>New section</Button>}
        {onRearrange && (
          <Button variant="ghost" icon="ai" onClick={onRearrange} disabled={rearranging}>
            {rearranging ? 'Rearranging…' : 'Rearrange with AI'}
          </Button>
        )}
        {onRearrange && rearrangeError && (
          <span role="status" style={{ marginLeft: 8, fontSize: 12, color: 'var(--warn)' }}>{rearrangeError}</span>
        )}
      </div>
    </div>
  );
}
